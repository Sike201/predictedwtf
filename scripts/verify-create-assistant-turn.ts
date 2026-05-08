/**
 * Quick checks for create-assistant-turn parsing (run: npm run verify:create-assistant).
 */
import assert from "node:assert/strict";
import {
  parseCreateAssistantTurn,
  filterUsableMarketPayloads,
  SILENT_GROUP_ASSISTANT_REPLY,
} from "../lib/market/create-assistant-turn";
import { grokValidationToMarketDraft } from "../lib/market/validation-result";
import { extractMarketFromPrompt } from "../lib/ai/mock-extract";

function run() {
  const viber = parseCreateAssistantTurn({
    assistantMessage: "That could be a few YES/NO markets.\n\n• Will A win?",
    markets: [],
  });
  assert.equal(viber.marketPayloads.length, 0);
  assert.match(viber.assistantMessage, /YES\/NO/i);

  const group = parseCreateAssistantTurn({
    type: "market_group",
    eventTitle: "Viber Hackathon — Winner",
    assistantMessage: "Got it — here are the markets.",
    markets: [
      {
        question: "Will Cuddly win the Viber hackathon?",
        yesCondition: "YES if Cuddly wins.",
        noCondition: "NO otherwise.",
        endTimeUtc: new Date(Date.now() + 86400000).toISOString(),
        warning: null,
      },
      {
        question: "Will Matt win the Viber hackathon?",
        yesCondition: "YES if Matt wins.",
        noCondition: "NO otherwise.",
        endTimeUtc: new Date(Date.now() + 86400000).toISOString(),
        warning: null,
      },
    ],
  });
  assert.equal(group.assistantMessage, SILENT_GROUP_ASSISTANT_REPLY);
  assert.equal(group.eventTitle, "Viber Hackathon — Winner");
  assert.equal(filterUsableMarketPayloads(group.marketPayloads).length, 2);
  assert.equal(group.isMarketGroup, true);
  assert.match(group.eventGroupKey ?? "", /viber-hackathon-winner/);

  const meReply = parseCreateAssistantTurn({
    assistantMessage: "Locked in.",
    markets: [
      {
        question: "Will Evan win the Viber hackathon?",
        yesCondition: "YES if Evan wins.",
        noCondition: "NO otherwise.",
        endTimeUtc: new Date(Date.now() + 86400000).toISOString(),
        warning: null,
      },
    ],
  });
  assert.equal(meReply.marketPayloads.length, 1);
  const base = extractMarketFromPrompt("me");
  const draft = grokValidationToMarketDraft(meReply.marketPayloads[0]!, base, "me");
  assert.match(draft.question, /Evan/i);

  const multiFlat = parseCreateAssistantTurn({
    assistantMessage: "narration should be stripped",
    markets: [
      {
        question: "Will A win?",
        yesCondition: "YES if A wins.",
        noCondition: "NO otherwise.",
        endTimeUtc: new Date(Date.now() + 86400000).toISOString(),
        warning: null,
      },
      {
        question: "Will B win?",
        yesCondition: "YES if B wins.",
        noCondition: "NO otherwise.",
        endTimeUtc: new Date(Date.now() + 86400000).toISOString(),
        warning: null,
      },
    ],
  });
  assert.equal(multiFlat.assistantMessage, SILENT_GROUP_ASSISTANT_REPLY);
  assert.equal(multiFlat.isMarketGroup, true);

  const directYesNo = parseCreateAssistantTurn({
    assistantMessage: "Nice — one market.",
    markets: [],
    question: "Will Network School win the Viber hackathon?",
    yesCondition: "YES if they win.",
    noCondition: "NO otherwise.",
    endTimeUtc: new Date(Date.now() + 86400000).toISOString(),
    warning: null,
  } as Record<string, unknown>);
  assert.equal(directYesNo.marketPayloads.length, 1);

  const legacyErr = parseCreateAssistantTurn({
    error: "multi_outcome_detected",
    message: "blocked",
  });
  assert.equal(legacyErr.marketPayloads.length, 0);
  assert.equal(legacyErr.eventGroupKey, null);

  console.info("verify-create-assistant-turn: ok");
}

run();
