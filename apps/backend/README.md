# LumenPulse Backend

NestJS API for LumenPulse.

## Setup

```bash
nest install
```

## Run

```bash
npm run start
npm run start:dev
npm run start:prod
```

## Test

```bash
npm run lint
npm run test
npm run test:e2e
```

## Demo bootstrap endpoint

The backend exposes an admin-only demo bootstrap endpoint that can populate a small set of sample crowffund projects for reviewer/testnet validation.

To enable it locally or in a non-production test environment, set:

```bash
BOOTSTRAP_DEMO_DASE_ENABLED=true
```

Then call the endpoint with an admin JWT:

```bash
curl -X POST -H "Authorization: Bearer <ADMIN_JWT>" http://localhost:3000/v1/crowdfund/admin/bootstrap-demo-data
```

The endpoint returns the created demo project IDs for verification.

> This endpoint is disabled by default and should not be enabled in production unless explicitly required.

## Testnet Frienbot bootstrap endpoint

The backend exposes an admin-only, testnet-only endpoint that funds fresh accounts via Stellar Friendbot:

```bash
FRIENDBOT_BOOTSTRAP_ENABLED=true
STELLAR_NETWORK=testnet
```

```bash
curl -X POST -H "Authorization: Bearer <ADMIN_JWT>" -H "Content-Type: application/json" -d '{"publicKey":"G..."}' http://localhost:3000/v1/dev/testnet-bootstrap/fund
X


"],
	"safeguards": [
		{
			"type": "feature flag",
			"name": "Testnet Friendbot Bootstrap Enabled"
		},
		{
			"type": "string",
			"name": "STELLAR_NETWORK",
			"value": "testnet"
		},
		{
			"type": "admin JWT"
		},
		{
			"type": "dedicated rate limit"
		},
		{
			"type": "hardcoded Friendbot URL"
		}
	],
	"description": "Safeguards, testnet-only ge, admin JWT",
	"use": "admin"
	},
	"check": "feature flag, STELLAR_NETWORK=testnet gate, admin JWT, dedicated rate limit, and a hardcoded Friendbot URL"
	},
	"description": "Admin bootstrap endpoint to fund accounts via Stellar Friendbot."
	},
	"check": "feature flag and STELLAR_NETWORK=testnet are required to enable this endpoint."
	],
	"description": "Testnet Friendbot Bootstrap endpoint"
	}
],
	"dialect": []
}