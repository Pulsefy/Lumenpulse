import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisplayNameToUsers1774512800128 implements MigrationInterface {
  name = 'AddDisplayNameToUsers1774512800128';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" DROP CONSTRAINT "FK_portfolio_snapshots_userId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_password_reset_tokens_user"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_users_stellarPublicKey"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_portfolio_snapshots_userId_createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_password_reset_tokens_tokenHash"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_password_reset_tokens_userId"`,
    );
    await queryRunner.query(
      `CREATE TABLE "stellar_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "publicKey" character varying(56) NOT NULL, "label" character varying(100), "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_83c7f3b964fafc55c9d1f3b415c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3fd11f33a2c4378c5b981b7ab6" ON "stellar_accounts" ("publicKey") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_30de7c930c0b503349dea29979" ON "stellar_accounts" ("userId", "publicKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "daily_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "snapshot_date" date NOT NULL, "asset_symbol" character varying(20), "avg_sentiment" numeric(10,6) NOT NULL, "min_sentiment" numeric(10,6), "max_sentiment" numeric(10,6), "signal_count" integer NOT NULL, "total_volume" numeric(20,4), "volume_weighted_sentiment" numeric(10,6), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a59fc9e71e699cbca1342111da6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_daily_snapshots_date_asset" ON "daily_snapshots" ("snapshot_date", "asset_symbol") `,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tokenHash" character varying(255) NOT NULL, "userId" uuid NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "deviceInfo" character varying(255), "ipAddress" character varying(45), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c25bc63d248ca90e8dcc1d92d0" ON "refresh_tokens" ("tokenHash") `,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordHash"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "passwordHash" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "firstName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "lastName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "displayName" character varying(255)`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "bio" text`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "avatarUrl" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" "public"."users_role_enum" NOT NULL DEFAULT 'user'`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "username" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username")`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "profile" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "portfolio" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "rewards" jsonb NOT NULL DEFAULT '{"totalEarned":0}'`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "lastLogin" TIMESTAMP`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "isActive" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae" UNIQUE ("stellarPublicKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" DROP CONSTRAINT "FK_d4f98a41174caf9217c1498f387"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(`ALTER TABLE "users" ADD "id" SERIAL NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "stellarPublicKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "stellarPublicKey" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae" UNIQUE ("stellarPublicKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{"theme":"dark","notifications":{"email":true,"push":true}}'`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "createdAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updatedAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "UQ_143e4ae40220e82a7829dee20e7" UNIQUE ("url")`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN "sentimentScore"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "sentimentScore" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "id" uuid NOT NULL DEFAULT uuid_generate_v4()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "stellarPublicKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "stellarPublicKey" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae" UNIQUE ("stellarPublicKey")`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "createdAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updatedAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(`ALTER TABLE "users" ADD "id" SERIAL NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "stellarPublicKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "stellarPublicKey" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae" UNIQUE ("stellarPublicKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{"theme":"dark","notifications":{"email":true,"push":true}}'`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "createdAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updatedAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "UQ_143e4ae40220e82a7829dee20e7" UNIQUE ("url")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8bc9b0048dfefcac4f0259bf3a" ON "users" ("stellarPublicKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fde671dad2a68d61cdc532c96c" ON "portfolio_snapshots" ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1143abb8c3fad8b06dd857a8c9" ON "password_reset_tokens" ("tokenHash") `,
    );
    await queryRunner.query(
      `ALTER TABLE "stellar_accounts" ADD CONSTRAINT "FK_e00ee11642074093e8296354812" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" ADD CONSTRAINT "FK_d4f98a41174caf9217c1498f387" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "FK_35bee2c1e38cf9298c2a5033406" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_d6a19d4b4f6c62dcd29daa497e2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_d6a19d4b4f6c62dcd29daa497e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_610102b60fea1455310ccd299de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" DROP CONSTRAINT "FK_35bee2c1e38cf9298c2a5033406"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" DROP CONSTRAINT "FK_d4f98a41174caf9217c1498f387"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stellar_accounts" DROP CONSTRAINT "FK_e00ee11642074093e8296354812"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1143abb8c3fad8b06dd857a8c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fde671dad2a68d61cdc532c96c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8bc9b0048dfefcac4f0259bf3a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "UQ_143e4ae40220e82a7829dee20e7"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updatedAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "createdAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{"notifications": {"newsAlerts": true, "priceAlerts": true, "securityAlerts": true}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "stellarPublicKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "stellarPublicKey" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae" UNIQUE ("stellarPublicKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "id" uuid NOT NULL DEFAULT uuid_generate_v4()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updatedAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "createdAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "stellarPublicKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "stellarPublicKey" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae" UNIQUE ("stellarPublicKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(`ALTER TABLE "users" ADD "id" SERIAL NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP COLUMN "sentimentScore"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD "sentimentScore" numeric(10,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "UQ_143e4ae40220e82a7829dee20e7"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "updatedAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "createdAt"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "preferences" SET DEFAULT '{"notifications": {"newsAlerts": true, "priceAlerts": true, "securityAlerts": true}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "stellarPublicKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "stellarPublicKey" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae" UNIQUE ("stellarPublicKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "id"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "id" uuid NOT NULL DEFAULT uuid_generate_v4()`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" ADD CONSTRAINT "FK_d4f98a41174caf9217c1498f387" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_8bc9b0048dfefcac4f0259bf3ae"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "isActive"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastLogin"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "rewards"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "portfolio"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "profile"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" DROP COLUMN "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_assets" DROP COLUMN "createdAt"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatarUrl"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "bio"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "displayName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordHash"`);
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "role" "public"."users_role_enum" NOT NULL DEFAULT 'user'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "lastName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "firstName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "passwordHash" character varying(255)`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c25bc63d248ca90e8dcc1d92d0"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_daily_snapshots_date_asset"`,
    );
    await queryRunner.query(`DROP TABLE "daily_snapshots"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30de7c930c0b503349dea29979"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3fd11f33a2c4378c5b981b7ab6"`,
    );
    await queryRunner.query(`DROP TABLE "stellar_accounts"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_password_reset_tokens_userId" ON "password_reset_tokens" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_password_reset_tokens_tokenHash" ON "password_reset_tokens" ("tokenHash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_portfolio_snapshots_userId_createdAt" ON "portfolio_snapshots" ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_stellarPublicKey" ON "users" ("stellarPublicKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_password_reset_tokens_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "FK_portfolio_snapshots_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
