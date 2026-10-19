import type { AWS } from '@serverless/typescript';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Supabase credentials live in .env (gitignored), never in this file — they are
// secrets and GitHub push protection rejects them. Copy .env.example to .env.
const loadEnv = (): Record<string, string> => {
  try {
    const raw = readFileSync(resolve(__dirname, '.env'), 'utf-8');
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const eq = line.indexOf('=');
          return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
        })
        .filter(([key]) => key)
    );
  } catch {
    return {};
  }
};

const fileEnv = loadEnv();

const supabaseFor = (stage: string) => {
  const suffix = stage.toUpperCase();
  const url = process.env[`SUPABASE_URL_${suffix}`] ?? fileEnv[`SUPABASE_URL_${suffix}`];
  const key = process.env[`SUPABASE_KEY_${suffix}`] ?? fileEnv[`SUPABASE_KEY_${suffix}`];
  if (!url || !key) {
    throw new Error(
      `Missing SUPABASE_URL_${suffix} / SUPABASE_KEY_${suffix}. ` +
        'Copy .env.example to .env and fill in the values for this stage.'
    );
  }
  return { url, key };
};

const stageArg = process.argv.includes('--stage')
  ? process.argv[process.argv.indexOf('--stage') + 1]
  : 'dev';

const originsByStage: Record<string, string[]> = {
  hmb: [
    'https://mandiapplication.make73.com',
    'https://mandi-application-seven.vercel.app',
    'https://auction-hmb.make73.com',
    'https://hmb-auction.make73.com',
    'https://hmb-application.make73.com',
  ],
  his: [
    'https://cratehis.make73.com',
    'https://hiskisanbill.make73.com',
    'https://mandiauction.make73.com',
    'https://auction-hmb.make73.com',
  ],
};

const allowedOrigins = originsByStage[stageArg] ?? ['*'];

const serverlessConfiguration: AWS = {
  service: 'mandi-lambda-core',
  frameworkVersion: '4',

  // ❌ removed serverless-esbuild (now built-in)
  plugins: ['serverless-offline'],

  provider: {
    name: 'aws',
    runtime: 'nodejs20.x',
    region: 'ap-south-1',
    stage: '${opt:stage, "dev"}',

    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },

    httpApi: {
      cors: {
        allowedOrigins,
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'deviceId',
        ],
        allowedMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowCredentials: false,
      },
    },

    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
      SUPABASE_URL: '${self:custom.supabase.${self:provider.stage}.url}',
      SUPABASE_KEY: '${self:custom.supabase.${self:provider.stage}.key}',
      LOG_LEVEL: '${opt:logLevel, "INFO"}',
      SERVICE_NAME: 'mandi-lambda-core',
      // Read from the deploy shell, NOT committed — the TTS alphabet is seeded
      // offline by `npm run seed:tts`, so the Lambda only needs this for the
      // rare on-demand render of a token that was never seeded.
      SARVAM_API_KEY: '${env:SARVAM_API_KEY, ""}',
    },
  },

  functions: {
    crate: {
      handler: 'src/crate/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/crate', method: 'get' } },
        { httpApi: { path: '/crate', method: 'post' } },
        { httpApi: { path: '/crate/{proxy+}', method: 'get' } },
        { httpApi: { path: '/crate/{proxy+}', method: 'post' } },
        { httpApi: { path: '/crate/{proxy+}', method: 'put' } },
      ],
    },
    party: {
      handler: 'src/party/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/party', method: 'post' } },
        { httpApi: { path: '/party', method: 'patch' } },
        { httpApi: { path: '/party/{proxy+}', method: 'get' } },
        { httpApi: { path: '/party/{proxy+}', method: 'post' } },
      ],
    },
    item: {
      handler: 'src/item/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/item/{proxy+}', method: 'get' } },
        { httpApi: { path: '/item/{proxy+}', method: 'post' } },
        { httpApi: { path: '/listItems', method: 'get' } },
        { httpApi: { path: '/createItem', method: 'post' } },
      ],
    },
    kisan: {
      handler: 'src/kisan/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/kisan/{proxy+}', method: 'get' } },
        { httpApi: { path: '/kisan/{proxy+}', method: 'post' } },
      ],
    },
    device: {
      handler: 'src/device/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/device/{proxy+}', method: 'get' } },
        { httpApi: { path: '/device/{proxy+}', method: 'post' } },
        { httpApi: { path: '/device/{proxy+}', method: 'put' } },
      ],
    },
    vyapari: {
      handler: 'src/vyapari/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/vyapari/{proxy+}', method: 'get' } },
        { httpApi: { path: '/vyapari/{proxy+}', method: 'post' } },
        { httpApi: { path: '/vyapari/{proxy+}', method: 'put' } },
      ],
    },
    auction: {
      handler: 'src/auction/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/auction', method: 'post' } },
        { httpApi: { path: '/auction/{proxy+}', method: 'get' } },
        { httpApi: { path: '/auction/{proxy+}', method: 'post' } },
        { httpApi: { path: '/auction/{proxy+}', method: 'delete' } },
        { httpApi: { path: '/auction/{proxy+}', method: 'patch' } },
      ],
    },
    tts: {
      handler: 'src/tts/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/tts/{proxy+}', method: 'get' } },
        { httpApi: { path: '/tts/{proxy+}', method: 'post' } },
      ],
    },
    bill: {
      handler: 'src/bill/handler.handler',
      logRetentionInDays: 30,
      events: [
        { httpApi: { path: '/bills/{proxy+}', method: 'get' } },
        { httpApi: { path: '/bills/{proxy+}', method: 'post' } },
        { httpApi: { path: '/bills/{proxy+}', method: 'patch' } },
      ],
    },
  },

  package: {
    individually: true,
  },

  // ✅ NEW: ESBuild config moved under `custom` to satisfy types

  custom: {
    esbuild: {
      bundle: true,
      minify: false,
      sourcemap: true,
      target: 'node20',
      platform: 'node',
      concurrency: 10,
      external: ['aws-sdk'],
    },
    supabase: {
      [stageArg]: supabaseFor(stageArg),
    },
  },
};

export default serverlessConfiguration;