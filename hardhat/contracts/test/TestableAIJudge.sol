// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AIJudge} from "../AIJudge.sol";

/// @notice Test-only subclass that returns a canned inference result instead of
/// calling the Ritual LLM precompile, which does not exist on a local EVM.
contract TestableAIJudge is AIJudge {
    bytes private review;
    bool private failed;
    string private failureMessage;

    function setInferenceResult(
        bytes calldata _review,
        bool _failed,
        string calldata _failureMessage
    ) external {
        review = _review;
        failed = _failed;
        failureMessage = _failureMessage;
    }

    function _runInference(
        bytes calldata
    ) internal view override returns (bytes memory) {
        return
            abi.encode(
                failed,
                review,
                bytes(""),
                failureMessage,
                ConvoHistory("", "", "")
            );
    }
}
