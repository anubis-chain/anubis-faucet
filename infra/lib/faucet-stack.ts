import * as path from 'node:path';
import {
  CfnCondition,
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { StageConfig } from './config';

export interface FaucetStackProps extends StackProps {
  readonly config: StageConfig;
  readonly webAclArn: string;
}

function decimalToUnits(value: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(value) || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Invalid token amount/decimals: ${value}/${decimals}`);
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Token amount exceeds token precision.');
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

function grantTransactionalClaimAccess(table: dynamodb.Table, fn: lambda.Function): void {
  table.grant(fn, 'dynamodb:GetItem');
  fn.addToRolePolicy(new iam.PolicyStatement({
    actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
    resources: [table.tableArn],
    conditions: {
      'ForAnyValue:StringEquals': {
        'dynamodb:EnclosingOperation': ['TransactWriteItems'],
      },
    },
  }));
}

export class FaucetStack extends Stack {
  constructor(scope: Construct, id: string, props: FaucetStackProps) {
    super(scope, id, props);

    const { config } = props;
    const production = config.stage === 'production';
    const dataRemovalPolicy = production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const logRetention = production ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH;

    const alertEmail = new CfnParameter(this, 'AlertEmail', {
      type: 'String',
      default: '',
      description: 'Optional alarm email address. The SNS confirmation message must be accepted.',
      allowedPattern: '^$|^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      constraintDescription: 'Enter a valid email address or leave this parameter empty.',
    });
    const hasAlertEmail = new CfnCondition(this, 'HasAlertEmail', {
      expression: Fn.conditionNot(Fn.conditionEquals(alertEmail.valueAsString, '')),
    });

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: `Anubis faucet ${config.stage} alarms`,
      topicName: `anubis-faucet-${config.stage}-alarms`,
    });
    const emailSubscription = new sns.CfnSubscription(this, 'AlarmEmailSubscription', {
      endpoint: alertEmail.valueAsString,
      protocol: 'email',
      topicArn: alarmTopic.topicArn,
    });
    emailSubscription.cfnOptions.condition = hasAlertEmail;

    const runtimeSecret = new secretsmanager.Secret(this, 'RuntimeSecret', {
      secretName: `anubis-faucet/${config.stage}/runtime`,
      description: 'Replace both placeholder values before enabling claims. IP_HASH_PEPPER is generated.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          privateKey: 'REPLACE_WITH_0x_PLUS_64_HEX_PRIVATE_KEY',
          turnstileSecret: 'REPLACE_WITH_TURNSTILE_SECRET_KEY',
        }),
        generateStringKey: 'ipPepper',
        excludePunctuation: true,
        passwordLength: 64,
      },
    });
    runtimeSecret.applyRemovalPolicy(dataRemovalPolicy);

    const claimsTable = new dynamodb.Table(this, 'ClaimsTable', {
      tableName: `anubis-faucet-${config.stage}-claims`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
        recoveryPeriodInDays: 35,
      },
      timeToLiveAttribute: 'expiresAt',
      deletionProtection: production,
      removalPolicy: dataRemovalPolicy,
    });
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      removalPolicy: dataRemovalPolicy,
      autoDeleteObjects: !production,
    });

    const commonEnvironment: Record<string, string> = {
      APP_STAGE: config.stage,
      FAUCET_ENABLED: String(config.faucetEnabled),
      DYNAMODB_TABLE_NAME: claimsTable.tableName,
      FAUCET_SECRET_ID: runtimeSecret.secretArn,
      RPC_URL: config.runtime.rpcUrl,
      CHAIN_ID: String(config.runtime.chainId),
      CHAIN_NAME: config.runtime.chainName,
      NATIVE_CURRENCY_NAME: config.runtime.nativeCurrencyName,
      NATIVE_CURRENCY_SYMBOL: config.runtime.nativeCurrencySymbol,
      NATIVE_CURRENCY_DECIMALS: '18',
      TOKEN_ADDRESS: config.runtime.tokenAddress,
      TOKEN_CODE_HASH: '0x938e093ab3e0191198ae5403f54f3725467fb6ac0ed1c0d0f9bacfdad2a242c7',
      TOKEN_DECIMALS: String(config.runtime.tokenDecimals),
      TOKEN_AMOUNT_WEI: decimalToUnits(config.runtime.tokenAmount, config.runtime.tokenDecimals),
      COOLDOWN_SECONDS: String(config.runtime.cooldownHours * 60 * 60),
      PREPARING_LEASE_SECONDS: '300',
      TOKEN_REPLAY_SECONDS: '86400',
      CLAIM_RETENTION_SECONDS: '7776000',
      DAILY_CLAIM_CAP: '100',
      TURNSTILE_HOSTNAMES: config.domainName,
      ALLOWED_ORIGINS: `https://${config.domainName}`,
      MAX_GAS_LIMIT: '150000',
      MAX_FEE_PER_GAS_WEI: '100000000000',
      MAX_PRIORITY_FEE_PER_GAS_WEI: '2000000000',
      MAX_TOTAL_FEE_WEI: '15000000000000000',
      MIN_CONFIRMATIONS: '1',
      TRUST_CLOUDFRONT_VIEWER_ADDRESS: 'true',
      SECRETS_CACHE_MS: '300000',
      NODE_OPTIONS: '--enable-source-maps',
    };
    if (config.allowedClaimAddress) {
      commonEnvironment.ALLOWED_CLAIM_ADDRESS = config.allowedClaimAddress;
    }

    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/aws/lambda/anubis-faucet-${config.stage}-api`,
      retention: logRetention,
      removalPolicy: dataRemovalPolicy,
    });
    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      functionName: `anubis-faucet-${config.stage}-api`,
      description: 'Same-origin faucet health and claim API behind CloudFront OAC',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: config.apiHandler,
      code: lambda.Code.fromAsset(config.backendAssetPath),
      environment: commonEnvironment,
      logGroup: apiLogGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      memorySize: 512,
      timeout: Duration.seconds(55),
    });
    grantTransactionalClaimAccess(claimsTable, apiFunction);
    runtimeSecret.grantRead(apiFunction);

    const apiAlias = new lambda.Alias(this, 'ApiLiveAlias', {
      aliasName: 'live',
      version: apiFunction.currentVersion,
      description: 'CloudFront targets this alias so releases can be rolled back safely.',
    });
    const apiFunctionUrl = apiAlias.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    // X-Amz-Content-Sha256 is owned by the Lambda OAC SigV4 flow. CloudFront
    // rejects attempts to list it in either request policy, but consumes and
    // forwards the viewer-provided value when it signs a POST origin request.
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      originRequestPolicyName: `anubis-faucet-${config.stage}-api-origin`,
      comment: 'Forwards API metadata and adds the trusted CloudFront viewer address.',
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'CloudFront-Viewer-Address',
        'Content-Type',
        'Origin',
      ),
    });

    const certificate = acm.Certificate.fromCertificateArn(this, 'ViewerCertificate', config.certificateArn);

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: `anubis-faucet-${config.stage}-security`,
      comment: 'Security headers with the minimum Turnstile and wallet connectivity allowances.',
      corsBehavior: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: ['Content-Type', 'X-Amz-Content-Sha256'],
        accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS', 'POST'],
        accessControlAllowOrigins: [`https://${config.domainName}`],
        accessControlExposeHeaders: ['Retry-After'],
        accessControlMaxAge: Duration.hours(1),
        originOverride: false,
      },
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "script-src 'self' https://challenges.cloudflare.com",
            "frame-src https://challenges.cloudflare.com",
            "connect-src 'self' https://challenges.cloudflare.com https://cheras-rpc.anubispace.org",
            "img-src 'self' data: blob:",
            "media-src 'self' blob:",
            "font-src 'self' data:",
            "style-src 'self'",
            "worker-src 'self' blob:",
          ].join('; '),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{
          header: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), payment=()',
          override: true,
        }],
      },
    });

    const spaRewrite = new cloudfront.Function(this, 'SpaRewriteFunction', {
      functionName: `anubis-faucet-${config.stage}-spa-rewrite`,
      comment: 'Rewrites extensionless frontend routes without changing /api responses.',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  if (request.method !== 'GET' || request.uri === '/api' || request.uri.indexOf('/api/') === 0) {
    return request;
  }
  var leaf = request.uri.substring(request.uri.lastIndexOf('/') + 1);
  if (request.uri.endsWith('/')) {
    request.uri += 'index.html';
  } else if (leaf.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`),
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Anubis faucet ${config.stage}`,
      defaultRootObject: 'index.html',
      domainNames: [config.domainName],
      certificate,
      webAclId: props.webAclArn,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      enableIpv6: true,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        responseHeadersPolicy: securityHeaders,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: spaRewrite,
        }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiFunctionUrl, {
            readTimeout: Duration.seconds(60),
          }),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          compress: true,
          originRequestPolicy: apiOriginRequestPolicy,
          responseHeadersPolicy: securityHeaders,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
      },
    });

    // CloudFront OAC creates lambda:InvokeFunctionUrl permission. Function URLs
    // created after October 2025 also require lambda:InvokeFunction. CDK 2.269.0
    // does not currently emit that second statement for FunctionUrlOrigin, so
    // keep this explicit and scope it to the one distribution and URL pathway.
    new lambda.CfnPermission(this, 'AllowCloudFrontInvokeFunction', {
      action: 'lambda:InvokeFunction',
      functionName: apiAlias.functionArn,
      principal: 'cloudfront.amazonaws.com',
      sourceArn: distribution.distributionArn,
      invokedViaFunctionUrl: true,
    });

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(config.siteAssetPath)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
      retainOnDelete: production,
    });

    const reconcileLogGroup = new logs.LogGroup(this, 'ReconcileLogGroup', {
      logGroupName: `/aws/lambda/anubis-faucet-${config.stage}-reconcile`,
      retention: logRetention,
      removalPolicy: dataRemovalPolicy,
    });
    const reconcileFunction = new lambda.Function(this, 'ReconcileFunction', {
      functionName: `anubis-faucet-${config.stage}-reconcile`,
      description: 'Reconciles and safely rebroadcasts the single durable signed faucet transaction',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: config.reconcileHandler,
      code: lambda.Code.fromAsset(config.backendAssetPath),
      environment: commonEnvironment,
      logGroup: reconcileLogGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      memorySize: 512,
      timeout: Duration.seconds(50),
    });
    grantTransactionalClaimAccess(claimsTable, reconcileFunction);
    const reconcileAlias = new lambda.Alias(this, 'ReconcileLiveAlias', {
      aliasName: 'live',
      version: reconcileFunction.currentVersion,
      description: 'EventBridge targets this alias so reconciliation can be rolled back with the API.',
    });

    const reconcileDlq = new sqs.Queue(this, 'ReconcileDeadLetterQueue', {
      queueName: `anubis-faucet-${config.stage}-reconcile-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      removalPolicy: dataRemovalPolicy,
    });
    const reconcileRule = new events.Rule(this, 'ReconcileSchedule', {
      ruleName: `anubis-faucet-${config.stage}-reconcile-every-minute`,
      description: 'Runs transaction receipt reconciliation every minute.',
      schedule: events.Schedule.rate(Duration.minutes(1)),
      enabled: true,
    });
    reconcileRule.addTarget(new targets.LambdaFunction(reconcileAlias, {
      deadLetterQueue: reconcileDlq,
      maxEventAge: Duration.minutes(5),
      retryAttempts: 2,
    }));

    // Function URL handlers intentionally convert operational failures into safe
    // JSON 5xx responses, so Lambda's native Errors metric remains zero. Derive
    // a separate count from the logger's allow-listed event/status fields nested
    // under the structured Lambda JSON envelope's message object.
    const apiHandledServerErrors = new logs.MetricFilter(this, 'ApiHandledServerErrorsMetric', {
      logGroup: apiLogGroup,
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.stringValue('$.message.event', '=', 'http_request_failed'),
        logs.FilterPattern.numberValue('$.message.status', '>=', 500),
        logs.FilterPattern.numberValue('$.message.status', '<', 600),
      ),
      metricNamespace: 'AnubisFaucet',
      metricName: `${config.stage}-api-handled-5xx`,
      metricValue: '1',
      defaultValue: 0,
      unit: cloudwatch.Unit.COUNT,
    });

    const alarmAction = new cloudwatchActions.SnsAction(alarmTopic);
    const alarms: cloudwatch.Alarm[] = [
      new cloudwatch.Alarm(this, 'ApiErrorsAlarm', {
        alarmName: `anubis-faucet-${config.stage}-api-errors`,
        metric: apiFunction.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'ApiThrottlesAlarm', {
        alarmName: `anubis-faucet-${config.stage}-api-throttles`,
        metric: apiFunction.metricThrottles({ period: Duration.minutes(5), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'ApiHandledServerErrorsAlarm', {
        alarmName: `anubis-faucet-${config.stage}-api-handled-5xx`,
        metric: apiHandledServerErrors.metric({
          period: Duration.minutes(5),
          statistic: 'Sum',
        }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'ApiDurationAlarm', {
        alarmName: `anubis-faucet-${config.stage}-api-duration-p95`,
        metric: apiFunction.metricDuration({ period: Duration.minutes(5), statistic: 'p95' }),
        threshold: 25_000,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'ReconcileErrorsAlarm', {
        alarmName: `anubis-faucet-${config.stage}-reconcile-errors`,
        metric: reconcileFunction.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'ReconcileThrottlesAlarm', {
        alarmName: `anubis-faucet-${config.stage}-reconcile-throttles`,
        metric: reconcileFunction.metricThrottles({ period: Duration.minutes(5), statistic: 'Sum' }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'ReconcileDlqAlarm', {
        alarmName: `anubis-faucet-${config.stage}-reconcile-dlq-not-empty`,
        metric: reconcileDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: 'Maximum' }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    alarms.forEach(alarm => alarm.addAlarmAction(alarmAction));

    const publicHost = config.domainName;
    new CfnOutput(this, 'CloudFrontDomainName', {
      description: 'Cloudflare DNS-only CNAME target. Apex records use Cloudflare CNAME flattening.',
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, 'CloudFrontDistributionArn', {
      description: 'Use with WebAclArn to subscribe this distribution to an eligible CloudFront flat-rate plan.',
      value: distribution.distributionArn,
    });
    new CfnOutput(this, 'SiteUrl', { value: `https://${publicHost}` });
    new CfnOutput(this, 'HealthUrl', { value: `https://${publicHost}/api/health` });
    new CfnOutput(this, 'CustomDomain', {
      description: 'Configured CloudFront alias.',
      value: config.domainName,
    });
    new CfnOutput(this, 'FaucetEnabled', {
      description: 'Claims remain disabled until preflight is complete and the stack is redeployed with -c faucetEnabled=true.',
      value: String(config.faucetEnabled),
    });
    new CfnOutput(this, 'RuntimeSecretArn', {
      description: 'Replace the placeholder faucet and Turnstile values out-of-band before claims are enabled.',
      value: runtimeSecret.secretArn,
    });
    new CfnOutput(this, 'ClaimsTableName', { value: claimsTable.tableName });
    new CfnOutput(this, 'ApiFunctionName', { value: apiFunction.functionName });
    new CfnOutput(this, 'ReconcileFunctionName', { value: reconcileFunction.functionName });
    new CfnOutput(this, 'AlarmTopicArn', { value: alarmTopic.topicArn });
    new CfnOutput(this, 'WalletFundingPreflight', {
      description: 'Funding and readiness facts. Never place a private key in CloudFormation parameters or outputs.',
      value: `Chain ${config.runtime.chainId}; RPC ${config.runtime.rpcUrl}; fund the secret-derived wallet with enough DAI for ${config.runtime.tokenAmount} payout per claim and the chain's pre-Aria DAI gas charging; verify eth_estimateGas and one manually approved live ERC-20 transfer before enabling claims. Token ${config.runtime.tokenAddress}.`,
    });
  }
}
