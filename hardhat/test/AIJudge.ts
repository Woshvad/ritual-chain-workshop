import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { network } from "hardhat";
import { encodePacked, keccak256, parseEther, type Address } from "viem";

const SALT_A = `0x${"a1".repeat(32)}` as const;
const SALT_B = `0x${"b2".repeat(32)}` as const;

describe("AIJudge commit-reveal", () => {
  let viem: Awaited<ReturnType<typeof network.connect>>["viem"];
  let publicClient: any;
  let testClient: any;
  let owner: any;
  let alice: any;
  let bob: any;

  before(async () => {
    const connection = await network.connect();
    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    testClient = await viem.getTestClient();
    [owner, alice, bob] = await viem.getWalletClients();
  });

  let judge: any;
  let subDeadline: bigint;
  let revDeadline: bigint;

  beforeEach(async () => {
    judge = await viem.deployContract("TestableAIJudge");
    const block = await publicClient.getBlock();
    subDeadline = block.timestamp + 1000n;
    revDeadline = block.timestamp + 2000n;
  });

  function commitmentOf(
    answer: string,
    salt: `0x${string}`,
    who: Address,
    bountyId: bigint,
  ) {
    return keccak256(
      encodePacked(
        ["string", "bytes32", "address", "uint256"],
        [answer, salt, who, bountyId],
      ),
    );
  }

  async function send(promise: Promise<`0x${string}`>) {
    const hash = await promise;
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async function advanceTo(target: bigint) {
    const block = await publicClient.getBlock();
    const delta = target - block.timestamp + 1n;
    if (delta > 0n) {
      await testClient.increaseTime({ seconds: Number(delta) });
      await testClient.mine({ blocks: 1 });
    }
  }

  async function expectRevert(promise: Promise<unknown>, reason: string) {
    await assert.rejects(promise, (err: any) => {
      assert.match(err.message ?? String(err), new RegExp(reason));
      return true;
    });
  }

  async function createBounty(account = owner) {
    await send(
      judge.write.createBounty(["Best haiku", "Most original", subDeadline, revDeadline], {
        value: parseEther("1"),
        account: account.account,
      }),
    );
    return 1n;
  }

  it("creates a bounty with both deadlines", async () => {
    const id = await createBounty();
    const b = await judge.read.getBounty([id]);
    assert.equal(b[0].toLowerCase(), owner.account.address.toLowerCase());
    assert.equal(b[4], subDeadline);
    assert.equal(b[5], revDeadline);
    assert.equal(b[3], parseEther("1"));
  });

  it("rejects a bounty with no reward", async () => {
    await expectRevert(
      judge.write.createBounty(["t", "r", subDeadline, revDeadline], {
        value: 0n,
        account: owner.account,
      }),
      "reward required",
    );
  });

  it("rejects a reveal deadline that is not after the submission deadline", async () => {
    await expectRevert(
      judge.write.createBounty(["t", "r", revDeadline, subDeadline], {
        value: parseEther("1"),
        account: owner.account,
      }),
      "reveal must follow submission",
    );
  });

  it("accepts a commitment during the submission phase", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));

    const sub = await judge.read.getSubmission([id, 0n]);
    assert.equal(sub[0].toLowerCase(), alice.account.address.toLowerCase());
    assert.equal(sub[1], c);
    assert.equal(sub[2], false);
    assert.equal(sub[3], "");
  });

  it("hides the answer until it is revealed", async () => {
    const id = await createBounty();
    const c = commitmentOf("secret answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));

    const before = await judge.read.getSubmission([id, 0n]);
    assert.equal(before[3], "");

    await advanceTo(subDeadline);
    await send(
      judge.write.revealAnswer([id, "secret answer", SALT_A], { account: alice.account }),
    );

    const after = await judge.read.getSubmission([id, 0n]);
    assert.equal(after[2], true);
    assert.equal(after[3], "secret answer");
  });

  it("rejects a second commitment from the same address", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await expectRevert(
      judge.write.submitCommitment([id, c], { account: alice.account }),
      "already committed",
    );
  });

  it("rejects a commitment after the submission deadline", async () => {
    const id = await createBounty();
    await advanceTo(subDeadline);
    const c = commitmentOf("late", SALT_A, alice.account.address, id);
    await expectRevert(
      judge.write.submitCommitment([id, c], { account: alice.account }),
      "submissions closed",
    );
  });

  it("rejects a reveal before the submission deadline", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await expectRevert(
      judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }),
      "reveal not open",
    );
  });

  it("rejects a reveal after the reveal deadline", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(revDeadline);
    await expectRevert(
      judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }),
      "reveal closed",
    );
  });

  it("rejects a reveal with the wrong salt", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await expectRevert(
      judge.write.revealAnswer([id, "answer", SALT_B], { account: alice.account }),
      "commitment mismatch",
    );
  });

  it("rejects a reveal with a tampered answer", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await expectRevert(
      judge.write.revealAnswer([id, "improved answer", SALT_A], { account: alice.account }),
      "commitment mismatch",
    );
  });

  it("rejects a reveal from an address that never committed", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await expectRevert(
      judge.write.revealAnswer([id, "answer", SALT_A], { account: bob.account }),
      "no commitment",
    );
  });

  it("rejects revealing the same commitment twice", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await send(judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }));
    await expectRevert(
      judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }),
      "already revealed",
    );
  });

  it("blocks another participant from revealing someone else's answer", async () => {
    // Bob copies Alice's commitment hash but cannot reveal it: the hash binds
    // to msg.sender, so the same plaintext under his address will not match.
    const id = await createBounty();
    const aliceCommit = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, aliceCommit], { account: alice.account }));
    await send(judge.write.submitCommitment([id, aliceCommit], { account: bob.account }));
    await advanceTo(subDeadline);
    await expectRevert(
      judge.write.revealAnswer([id, "answer", SALT_A], { account: bob.account }),
      "commitment mismatch",
    );
  });

  it("rejects judging before the reveal phase ends", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await send(judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }));
    await expectRevert(
      judge.write.judgeAll([id, "0x"], { account: owner.account }),
      "reveal phase open",
    );
  });

  it("rejects judging by a non-owner", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(revDeadline);
    await expectRevert(
      judge.write.judgeAll([id, "0x"], { account: alice.account }),
      "not bounty owner",
    );
  });

  it("rejects judging with no revealed answers", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(revDeadline);
    await expectRevert(
      judge.write.judgeAll([id, "0x"], { account: owner.account }),
      "no revealed answers",
    );
  });

  it("judges revealed answers and pays the finalized winner", async () => {
    const id = await createBounty();
    const c = commitmentOf("winning answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await send(judge.write.revealAnswer([id, "winning answer", SALT_A], { account: alice.account }));
    await advanceTo(revDeadline);

    await send(judge.write.setInferenceResult(["0x1234", false, ""], { account: owner.account }));
    await send(judge.write.judgeAll([id, "0x"], { account: owner.account }));

    const judged = await judge.read.getBounty([id]);
    assert.equal(judged[6], true);
    assert.equal(judged[11], "0x1234");

    const before = await publicClient.getBalance({ address: alice.account.address });
    await send(judge.write.finalizeWinner([id, 0n], { account: owner.account }));
    const after = await publicClient.getBalance({ address: alice.account.address });

    assert.equal(after - before, parseEther("1"));

    const finalized = await judge.read.getBounty([id]);
    assert.equal(finalized[7], true);
    assert.equal(finalized[10], 0n);
  });

  it("surfaces an inference error instead of marking judged", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await send(judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }));
    await advanceTo(revDeadline);

    await send(judge.write.setInferenceResult(["0x", true, "model unavailable"], { account: owner.account }));
    await expectRevert(
      judge.write.judgeAll([id, "0x"], { account: owner.account }),
      "model unavailable",
    );
  });

  it("rejects finalizing before judging", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await send(judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }));
    await advanceTo(revDeadline);
    await expectRevert(
      judge.write.finalizeWinner([id, 0n], { account: owner.account }),
      "not judged yet",
    );
  });

  it("rejects finalizing an unrevealed submission as the winner", async () => {
    const id = await createBounty();
    const aliceCommit = commitmentOf("answer", SALT_A, alice.account.address, id);
    const bobCommit = commitmentOf("other", SALT_B, bob.account.address, id);
    await send(judge.write.submitCommitment([id, aliceCommit], { account: alice.account }));
    await send(judge.write.submitCommitment([id, bobCommit], { account: bob.account }));
    await advanceTo(subDeadline);
    await send(judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }));
    await advanceTo(revDeadline);

    await send(judge.write.setInferenceResult(["0x1234", false, ""], { account: owner.account }));
    await send(judge.write.judgeAll([id, "0x"], { account: owner.account }));

    await expectRevert(
      judge.write.finalizeWinner([id, 1n], { account: owner.account }),
      "winner not revealed",
    );
  });

  it("rejects finalizing twice", async () => {
    const id = await createBounty();
    const c = commitmentOf("answer", SALT_A, alice.account.address, id);
    await send(judge.write.submitCommitment([id, c], { account: alice.account }));
    await advanceTo(subDeadline);
    await send(judge.write.revealAnswer([id, "answer", SALT_A], { account: alice.account }));
    await advanceTo(revDeadline);
    await send(judge.write.setInferenceResult(["0x1234", false, ""], { account: owner.account }));
    await send(judge.write.judgeAll([id, "0x"], { account: owner.account }));
    await send(judge.write.finalizeWinner([id, 0n], { account: owner.account }));
    await expectRevert(
      judge.write.finalizeWinner([id, 0n], { account: owner.account }),
      "already finalized",
    );
  });
});
