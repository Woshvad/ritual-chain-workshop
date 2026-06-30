# Privacy-Preserving AI Bounty Judge

Commit-reveal version of the workshop AI Bounty Judge. Submissions stay hidden
during the submission phase and are only revealed once it closes, so later
entrants cannot read earlier answers and submit an improved copy.

Author: Woshvad

## Why the change

In the workshop build, `submitAnswer` wrote the plaintext answer straight into
contract storage. Anything in contract storage is public, so a participant could
read every earlier answer, take the best ideas, and submit a stronger entry
before the deadline. In a bounty where only one person wins, that is unfair.

This version replaces the single public submission with a two-phase
commit-reveal flow. During submission you only publish a hash. After submission
closes you reveal the answer and the contract checks it against that hash. The
answer text is never readable on-chain until you reveal it yourself.

## Lifecycle

1. **Create.** The owner calls `createBounty` with a title, rubric, submission
   deadline, and reveal deadline, and funds the reward with `msg.value`.
2. **Commit.** During the submission phase, each participant calls
   `submitCommitment` with `keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))`.
   Only the hash is stored. One commitment per address.
3. **Reveal.** After the submission deadline and before the reveal deadline,
   each participant calls `revealAnswer` with their answer and salt. The contract
   recomputes the hash and stores the answer only if it matches.
4. **Judge.** After the reveal deadline, the owner calls `judgeAll` with the
   encoded Ritual LLM request. Only revealed answers are part of the batch. The
   call forwards to the LLM precompile and stores the returned review.
5. **Finalize.** The owner reads the AI review, then calls `finalizeWinner` with
   the chosen index. The winner must be a revealed submission. The contract pays
   the reward.

## Required functions

```solidity
function submitCommitment(uint256 bountyId, bytes32 commitment) external;
function revealAnswer(uint256 bountyId, string calldata answer, bytes32 salt) external;
function judgeAll(uint256 bountyId, bytes calldata llmInput) external;
function finalizeWinner(uint256 bountyId, uint256 winnerIndex) external;
```

The commitment binds the answer to the sender and the bounty:

```solidity
bytes32 commitment = keccak256(
    abi.encodePacked(answer, salt, msg.sender, bountyId)
);
```

Including `msg.sender` and `bountyId` means a copied hash is useless to anyone
else. If Bob replays Alice's commitment under his own address, his reveal
recomputes the hash with his address and fails to match.

## Rules enforced by the contract

- Commitments are accepted only before the submission deadline.
- Reveals are accepted only after the submission deadline and before the reveal
  deadline.
- One commitment per address per bounty.
- A reveal is valid only if the recomputed hash matches the commitment.
- `getSubmission` returns an empty answer until the submitter reveals it, so
  plaintext never leaks during submission.
- Judging is owner-only and only after the reveal deadline, and needs at least
  one revealed answer.
- Finalizing is owner-only, only after judging, and only for a revealed
  submission.
- The reward is paid once. `reward` is zeroed before the transfer to guard
  against reentrancy, and a single winner is paid.

## Running the tests

```bash
cd hardhat
pnpm install
npx hardhat test
```

The Ritual LLM precompile only exists on Ritual Chain, so the test suite uses
`contracts/test/TestableAIJudge.sol`, a subclass that overrides the single
inference call and returns a canned result. That keeps the whole commit, reveal,
judge, and finalize path testable on a local node. The suite in
`test/AIJudge.ts` covers valid reveals and the invalid cases: wrong salt,
tampered answer, revealing too early or too late, revealing without a
commitment, double reveal, replaying another address's commitment, judging
before the reveal deadline, judging as a non-owner, finalizing before judging,
finalizing an unrevealed winner, and finalizing twice.

## Deploying

`ignition/modules/AIJudge.ts` deploys the contract. The Ritual network is
configured in `hardhat.config.ts`.

```bash
npx hardhat ignition deploy --network ritual ignition/modules/AIJudge.ts
```

## Frontend

The `web/` app is left on the original single-submission flow. To run the new
flow it needs three changes:

- `SubmitAnswer` should compute the commitment and call `submitCommitment`, and
  keep the answer and salt locally so the user can reveal later.
- A reveal step is needed that calls `revealAnswer` during the reveal window.
- `JudgeAll` gathers answers off-chain to build the prompt. `getSubmission` now
  returns `(submitter, commitment, revealed, answer)`, so the gather loop should
  skip entries where `revealed` is false.

## Files

- `hardhat/contracts/AIJudge.sol` - the commit-reveal contract.
- `hardhat/contracts/test/TestableAIJudge.sol` - test-only inference override.
- `hardhat/test/AIJudge.ts` - the test suite.
- `ARCHITECTURE.md` - commit-reveal vs Ritual-native TEE submissions, and the
  advanced design.
- `REFLECTION.md` - the reflection answer.
