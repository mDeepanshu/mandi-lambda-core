import type { AWS } from '@serverless/typescript';


const serverlessConfiguration: AWS = {
  service: 'mandi-lambda-core',
  frameworkVersion: '3',
  plugins: ['serverless-esbuild', 'serverless-offline'],
  provider: {
    name: 'aws',
    runtime: 'nodejs20.x',
    region: 'ap-south-1',
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    httpApi: {
      cors: {
        allowedOrigins: [
          'http://localhost:4200',
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:3002',
          'http://localhost:3003',
        ],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'deviceId',
        ],
        allowedMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowCredentials: true,
      },
    },
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_KEY: process.env.SUPABASE_KEY,
    },
  },
  // import the function via paths
  functions: {
    party: {
      handler: 'src/party/handler.handler',
      events: [{ httpApi: { path: '/party/{proxy+}', method: '*' } }],
    },

    item: {
      handler: 'src/item/handler.handler',
      events: [{ httpApi: { path: '/item/{proxy+}', method: '*' } }],
    },

    kisan: {
      handler: 'src/kisan/handler.handler',
      events: [{ httpApi: { path: '/kisan/{proxy+}', method: '*' } }],
    },
    device: {
      handler: 'src/device/handler.handler',
      events: [
        {
          httpApi: {
            path: '/device/{proxy+}',
            method: '*',
          },
        },
      ],
    },
    vyapari: {
      handler: 'src/vyapari/handler.handler',
      events: [
        {
          httpApi: {
            path: '/vyapari/{proxy+}',
            method: '*',
          },
        },
      ],
    },
    auction: {
      handler: 'src/auction/handler.handler',
      events: [
        {
          httpApi: {
            path: '/auction/{proxy+}',
            method: '*',
          },
        },
      ],
    },
    bill: {
      handler: 'src/bill/handler.handler',
      events: [
        {
          httpApi: {
            path: '/bills/{proxy+}',
            method: '*',
          },
        },
      ],
    },
  },
  package: { individually: true },
  custom: {
    esbuild: {
      bundle: true,
      minify: false,
      sourcemap: true,
      exclude: ['aws-sdk'],
      target: 'node14',
      define: { 'require.resolve': undefined },
      platform: 'node',
      concurrency: 10,
    },
  },
};

module.exports = serverlessConfiguration;
