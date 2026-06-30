# Reflection

**What should be public, what should stay hidden, and what should be decided by
AI versus by a human in a bounty system?**

The rules of the bounty should be public: the rubric, the reward, the deadlines,
and who took part, because participants need to trust the terms and verify the
outcome later. Each answer should stay hidden during the submission phase so
nobody can read an earlier entry and submit an improved copy, which is the whole
point of the commit-reveal and TEE designs. After judging is complete the
answers should become public, since transparency about why an entry won matters
more than secrecy once the contest is over. The AI is well suited to the
mechanical part of judging: reading every submission together, applying the
rubric, and proposing a ranking, all in one pass that treats entries
consistently. It should not hold the money or make the binding decision on its
own, because model output can be wrong or manipulated by instructions hidden
inside a submission. So the human owner stays in the loop and finalizes the
payout, using the AI review as advice rather than a verdict. The clean split is
that AI recommends and a person decides, with the contract enforcing the rules
that neither side should be able to bend.
