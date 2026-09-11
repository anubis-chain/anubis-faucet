import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface FaucetEdgeStackProps extends StackProps {
  readonly stageName: string;
  readonly rateLimitPerFiveMinutes: number;
}

export class FaucetEdgeStack extends Stack {
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: FaucetEdgeStackProps) {
    super(scope, id, props);

    const visibility = (name: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      metricName: name,
      sampledRequestsEnabled: true,
    });

    const apiRateLimitRule: wafv2.CfnWebACL.RuleProperty = {
      name: 'ApiDistributeRateLimit',
      priority: 0,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          aggregateKeyType: 'IP',
          evaluationWindowSec: 300,
          limit: props.rateLimitPerFiveMinutes,
          scopeDownStatement: {
            byteMatchStatement: {
              fieldToMatch: { uriPath: {} },
              positionalConstraint: 'EXACTLY',
              searchString: '/api/distribute',
              textTransformations: [{ priority: 0, type: 'NONE' }],
            },
          },
        },
      },
      visibilityConfig: visibility(`${props.stageName}-api-rate-limit`),
    };

    const allApiRateLimitRule: wafv2.CfnWebACL.RuleProperty = {
      name: 'AllApiRateLimit',
      priority: 1,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          aggregateKeyType: 'IP',
          evaluationWindowSec: 300,
          limit: Math.max(300, props.rateLimitPerFiveMinutes * 3),
          scopeDownStatement: {
            byteMatchStatement: {
              fieldToMatch: { uriPath: {} },
              positionalConstraint: 'STARTS_WITH',
              searchString: '/api/',
              textTransformations: [{ priority: 0, type: 'NONE' }],
            },
          },
        },
      },
      visibilityConfig: visibility(`${props.stageName}-all-api-rate-limit`),
    };

    const commonRuleSet: wafv2.CfnWebACL.RuleProperty = {
      name: 'AWSManagedCommonRules',
      priority: 10,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          name: 'AWSManagedRulesCommonRuleSet',
          vendorName: 'AWS',
        },
      },
      visibilityConfig: visibility(`${props.stageName}-aws-common-rules`),
    };

    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      description: `Edge protection for the Anubis faucet ${props.stageName} stage`,
      name: `anubis-faucet-${props.stageName}`,
      rules: [apiRateLimitRule, allApiRateLimitRule, commonRuleSet],
      scope: 'CLOUDFRONT',
      visibilityConfig: visibility(`${props.stageName}-web-acl`),
    });

    this.webAclArn = webAcl.attrArn;

    new CfnOutput(this, 'WebAclArn', {
      description: 'CloudFront-scope WAF web ACL ARN (created in us-east-1).',
      value: this.webAclArn,
    });
  }
}
