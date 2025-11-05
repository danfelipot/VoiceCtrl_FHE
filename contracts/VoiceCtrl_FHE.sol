pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VoiceControlFHE is ZamaEthereumConfig {
    struct EncryptedCommand {
        euint32 encryptedIntent;
        uint256 timestamp;
        address sender;
        bool isProcessed;
        uint32 decryptedIntent;
    }

    mapping(string => EncryptedCommand) private commandRegistry;
    string[] private commandIds;

    event CommandReceived(string indexed commandId, address indexed sender);
    event CommandProcessed(string indexed commandId, uint32 decryptedIntent);

    constructor() ZamaEthereumConfig() {
    }

    function submitEncryptedCommand(
        string calldata commandId,
        externalEuint32 encryptedIntent,
        bytes calldata inputProof
    ) external {
        require(commandRegistry[commandId].sender == address(0), "Command ID already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedIntent, inputProof)), "Invalid encrypted input");

        euint32 internalEncryptedIntent = FHE.fromExternal(encryptedIntent, inputProof);

        commandRegistry[commandId] = EncryptedCommand({
            encryptedIntent: internalEncryptedIntent,
            timestamp: block.timestamp,
            sender: msg.sender,
            isProcessed: false,
            decryptedIntent: 0
        });

        FHE.allowThis(internalEncryptedIntent);
        FHE.makePubliclyDecryptable(internalEncryptedIntent);

        commandIds.push(commandId);

        emit CommandReceived(commandId, msg.sender);
    }

    function processCommand(
        string calldata commandId,
        bytes memory abiEncodedClearIntent,
        bytes memory decryptionProof
    ) external {
        require(commandRegistry[commandId].sender != address(0), "Command does not exist");
        require(!commandRegistry[commandId].isProcessed, "Command already processed");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(commandRegistry[commandId].encryptedIntent);

        FHE.checkSignatures(cts, abiEncodedClearIntent, decryptionProof);

        uint32 decodedIntent = abi.decode(abiEncodedClearIntent, (uint32));

        commandRegistry[commandId].decryptedIntent = decodedIntent;
        commandRegistry[commandId].isProcessed = true;

        emit CommandProcessed(commandId, decodedIntent);
    }

    function getEncryptedIntent(string calldata commandId) external view returns (euint32) {
        require(commandRegistry[commandId].sender != address(0), "Command does not exist");
        return commandRegistry[commandId].encryptedIntent;
    }

    function getCommandDetails(string calldata commandId) external view returns (
        uint256 timestamp,
        address sender,
        bool isProcessed,
        uint32 decryptedIntent
    ) {
        require(commandRegistry[commandId].sender != address(0), "Command does not exist");
        EncryptedCommand storage cmd = commandRegistry[commandId];

        return (
            cmd.timestamp,
            cmd.sender,
            cmd.isProcessed,
            cmd.decryptedIntent
        );
    }

    function getAllCommandIds() external view returns (string[] memory) {
        return commandIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


