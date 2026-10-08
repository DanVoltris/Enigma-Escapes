// How many people a marketing text cost you (migration 0012). Real PostgreSQL,
// because the rule lives in SQL:
//
//   npm run test:unsubscribes
//
// An unsubscribe counts against the campaign that last texted that person
// before they replied STOP. Anything we only learned from Twilio refusing a
// send ("they replied STOP to us before") belongs to no campaign — that person
// left earlier, and blaming this message for it would make a good campaign look
// like a bad one.
//
// The history already in the table is settled by a backfill, so the database
// here is built up to 0011, given the data a venue already has, and only then
// moved to 0012 — the way it will actually happen.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { applyMigration, asTenant, buildDatabase, claimsFor } from "./pg-harness.mjs";

const HALLOWEEN = "11111111-1111-4111-8111-111111111111";
const SUMMER = "22222222-2222-4222-8222-222222222222";

// Everyone in the story, with the phone they are known by.
const PHONE = {
  // Texted by the Hallowe'en campaign, replied STOP an hour later.
  annie: "2045550101",
  // Texted by both campaigns; stopped after the later one.
  bert: "2045550102",
  // Replied STOP long before either campaign — Twilio told us when a send bounced.
  cleo: "2045550103",
  // Texted by the summer campaign only, and stopped.
  dev: "2045550104",
  // Texted and perfectly happy about it.
  elsa: "2045550105",
};

describe("unsubscribes per campaign", () => {
  let db, tenant;

  before(async () => {
    db = await buildDatabase({ through: "0011" });
    tenant = (await db.query("select id from tenants limit 1")).rows[0].id;

    await db.exec("set role service_role");
    await db.query(
      `insert into campaigns (id, tenant_id, name, body, status, started_at) values
         ($1, $3, 'Hallowe''en', 'Hallowe''en at ours. Reply STOP to stop.', 'done', '2026-10-03T17:00:00Z'),
         ($2, $3, 'Summer', 'Summer hours. Reply STOP to stop.', 'done', '2026-07-01T17:00:00Z')`,
      [HALLOWEEN, SUMMER, tenant]
    );
    const recipient = async (campaign, phone, status, sentAt) =>
      db.query(
        `insert into campaign_recipients (tenant_id, campaign_id, phone, status, sent_at) values ($1, $2, $3, $4, $5)`,
        [tenant, campaign, phone, status, sentAt]
      );
    await recipient(HALLOWEEN, PHONE.annie, "sent", "2026-10-03T17:05:00Z");
    await recipient(HALLOWEEN, PHONE.bert, "sent", "2026-10-03T17:06:00Z");
    await recipient(HALLOWEEN, PHONE.elsa, "sent", "2026-10-03T17:07:00Z");
    // Cleo was on the list, but the send bounced: she had stopped long before.
    await recipient(HALLOWEEN, PHONE.cleo, "failed", null);
    await recipient(SUMMER, PHONE.bert, "sent", "2026-07-01T17:05:00Z");
    await recipient(SUMMER, PHONE.dev, "sent", "2026-07-01T17:06:00Z");

    // The opt-outs as they stand before 0012: no campaign on any of them.
    const stop = async (phone, when, source) =>
      db.query(`insert into sms_optouts (tenant_id, phone, created_at, source) values ($1, $2, $3, $4)`, [
        tenant,
        phone,
        when,
        source,
      ]);
    await stop(PHONE.annie, "2026-10-03T18:00:00Z", "reply");
    await stop(PHONE.bert, "2026-10-03T19:30:00Z", "reply");
    await stop(PHONE.cleo, "2026-10-03T17:05:00Z", "carrier");
    await stop(PHONE.dev, "2026-07-02T09:00:00Z", "reply");
    await db.exec("reset role");

    await applyMigration(db, "0012_campaign-optouts.sql");
  });

  const attributed = async (phone) =>
    (await db.query("select campaign_id from sms_optouts where phone = $1", [phone])).rows[0].campaign_id;

  test("the backfill credits each STOP to the campaign that last reached them", async () => {
    assert.equal(await attributed(PHONE.annie), HALLOWEEN);
    assert.equal(await attributed(PHONE.dev), SUMMER);
  });

  test("texted by two campaigns, the later one before they stopped gets it", async () => {
    assert.equal(await attributed(PHONE.bert), HALLOWEEN);
  });

  test("an opt-out the carrier told us about belongs to no campaign", async () => {
    assert.equal(await attributed(PHONE.cleo), null);
  });

  test("the portal's counts come out right", async () => {
    const [halloween] = (
      await asTenant(db, claimsFor(tenant), (tx) =>
        tx.query("select * from campaign_progress($1)", [HALLOWEEN])
      )
    ).rows;
    assert.equal(Number(halloween.sent), 3);
    assert.equal(Number(halloween.failed), 1);
    // Annie and Bert — not Cleo, whose send merely bounced off an older stop.
    assert.equal(Number(halloween.unsubscribed), 2);

    const all = (
      await asTenant(db, claimsFor(tenant), (tx) => tx.query("select * from campaign_progress_all()"))
    ).rows;
    const byId = new Map(all.map((r) => [r.campaign_id, r]));
    assert.equal(Number(byId.get(HALLOWEEN).unsubscribed), 2);
    assert.equal(Number(byId.get(SUMMER).unsubscribed), 1);
    assert.equal(Number(byId.get(SUMMER).sent), 2);
  });

  test("a STOP recorded from here on names its campaign, and is counted", async () => {
    await db.exec("set role service_role");
    await db.query(
      `insert into sms_optouts (tenant_id, phone, source, campaign_id) values ($1, $2, 'reply', $3)`,
      [tenant, PHONE.elsa, HALLOWEEN]
    );
    await db.exec("reset role");
    const [row] = (
      await asTenant(db, claimsFor(tenant), (tx) =>
        tx.query("select * from campaign_progress($1)", [HALLOWEEN])
      )
    ).rows;
    assert.equal(Number(row.unsubscribed), 3);
  });
});
