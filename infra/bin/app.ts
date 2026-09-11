#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { loadStageConfig } from '../lib/config';
import { FaucetEdgeStack } from '../lib/faucet-edge-stack';
import { FaucetStack } from '../lib/faucet-stack';

const app = new App();
const config = loadStageConfig(app);
const account = app.node.tryGetContext('account') ?? process.env.CDK_DEFAULT_ACCOUNT;
if (typeof account !== 'string' || !/^\d{12}$/.test(account)) {
  throw new Error('Provide a 12-digit AWS account using -c account=123456789012 or an authenticated CDK profile.');
}

const prefix = config.stage === 'production' ? 'Production' : 'Staging';
const edge = new FaucetEdgeStack(app, `AnubisFaucet-${prefix}-Edge`, {
  env: { account, region: 'us-east-1' },
  crossRegionReferences: true,
  description: `Anubis faucet ${config.stage} CloudFront WAF resources`,
  terminationProtection: config.stage === 'production',
  stageName: config.stage,
  rateLimitPerFiveMinutes: config.rateLimitPerFiveMinutes,
});

const regional = new FaucetStack(app, `AnubisFaucet-${prefix}`, {
  env: { account, region: config.primaryRegion },
  crossRegionReferences: true,
  description: `Anubis faucet ${config.stage} regional and CloudFront resources`,
  terminationProtection: config.stage === 'production',
  config,
  webAclArn: edge.webAclArn,
});
regional.addStackDependency(edge);

for (const stack of [edge, regional]) {
  Tags.of(stack).add('Application', 'anubis-faucet');
  Tags.of(stack).add('Environment', config.stage);
  Tags.of(stack).add('ManagedBy', 'aws-cdk');
}

app.synth();
