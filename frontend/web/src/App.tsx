import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import "./App.css";

interface VoiceCommand {
  id: string;
  name: string;
  encryptedValue: number;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [commands, setCommands] = useState<VoiceCommand[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCommand, setCreatingCommand] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ 
    visible: boolean; 
    status: "pending" | "success" | "error"; 
    message: string; 
  }>({ visible: false, status: "pending", message: "" });
  const [newCommandData, setNewCommandData] = useState({ 
    name: "", 
    value: "", 
    description: "" 
  });
  const [selectedCommand, setSelectedCommand] = useState<VoiceCommand | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("commands");
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        setContractAddress(await contract.getAddress());
        const businessIds = await contract.getAllBusinessIds();
        const commandsList: VoiceCommand[] = [];
        for (const id of businessIds) {
          const data = await contract.getBusinessData(id);
          commandsList.push({
            id,
            name: data.name,
            encryptedValue: 0,
            publicValue1: Number(data.publicValue1),
            publicValue2: Number(data.publicValue2),
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue)
          });
        }
        setCommands(commandsList);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isConnected]);

  const getContractReadOnly = async () => {
    return new ethers.Contract(
      "0xYourContractAddress",
      UniversalFHEAdapterABI,
      new ethers.providers.JsonRpcProvider("https://your.rpc.url")
    );
  };

  const getContractWithSigner = async () => {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    return new ethers.Contract(
      "0xYourContractAddress",
      UniversalFHEAdapterABI,
      provider.getSigner()
    );
  };

  const createCommand = async () => {
    if (!isConnected || !address) return;
    setCreatingCommand(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted command..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      const value = parseInt(newCommandData.value) || 0;
      const commandId = `cmd-${Date.now()}`;
      const encryptedResult = await encrypt(contractAddress, address, value);
      const tx = await contract.createBusinessData(
        commandId,
        newCommandData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newCommandData.description
      );
      await tx.wait();
      setTransactionStatus({ visible: true, status: "success", message: "Command created!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      setShowCreateModal(false);
      setNewCommandData({ name: "", value: "", description: "" });
      window.location.reload();
    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: e.message?.includes("rejected") ? "Transaction rejected" : "Creation failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setCreatingCommand(false);
    }
  };

  const decryptCommand = async (commandId: string) => {
    if (!isConnected || !address) return;
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      const contractWrite = await getContractWithSigner();
      if (!contractRead || !contractWrite) return;
      const encryptedValue = await contractRead.getEncryptedValue(commandId);
      const result = await verifyDecryption(
        [encryptedValue],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(commandId, abiEncodedClearValues, decryptionProof)
      );
      const clearValue = result.decryptionResult.clearValues[encryptedValue];
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Decryption verified!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    } finally {
      setIsDecrypting(false);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const available = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "System available: " + available 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Availability check failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredCommands = commands.filter(cmd => 
    cmd.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    cmd.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <h1>Private Voice Control 🔒</h1>
          <ConnectButton />
        </header>
        <div className="connection-prompt">
          <div className="voice-ball"></div>
          <h2>Connect Wallet to Start</h2>
          <p>Secure voice commands with FHE encryption</p>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="voice-wave"></div>
      <p>Loading voice commands...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Voice Control 🔒</h1>
          <p>Encrypted voice commands with FHE</p>
        </div>
        <ConnectButton />
      </header>

      <nav className="app-nav">
        <button 
          className={activeTab === "commands" ? "active" : ""}
          onClick={() => setActiveTab("commands")}
        >
          My Commands
        </button>
        <button 
          className={activeTab === "create" ? "active" : ""}
          onClick={() => setActiveTab("create")}
        >
          New Command
        </button>
        <button 
          className={activeTab === "stats" ? "active" : ""}
          onClick={() => setActiveTab("stats")}
        >
          Statistics
        </button>
      </nav>

      <main className="app-main">
        {activeTab === "commands" && (
          <div className="commands-section">
            <div className="search-bar">
              <input
                type="text"
                placeholder="Search commands..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button onClick={checkAvailability}>Check System</button>
            </div>
            
            <div className="commands-list">
              {filteredCommands.length === 0 ? (
                <div className="empty-state">
                  <p>No voice commands found</p>
                  <button onClick={() => setActiveTab("create")}>
                    Create First Command
                  </button>
                </div>
              ) : (
                filteredCommands.map((cmd, index) => (
                  <div 
                    key={index} 
                    className={`command-card ${cmd.isVerified ? "verified" : ""}`}
                    onClick={() => setSelectedCommand(cmd)}
                  >
                    <div className="command-name">{cmd.name}</div>
                    <div className="command-desc">{cmd.description}</div>
                    <div className="command-meta">
                      <span>Created: {new Date(cmd.timestamp * 1000).toLocaleDateString()}</span>
                      <span>{cmd.isVerified ? "✅ Verified" : "🔒 Encrypted"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === "create" && (
          <div className="create-section">
            <h2>New Voice Command</h2>
            <div className="create-form">
              <div className="form-group">
                <label>Command Name</label>
                <input
                  type="text"
                  value={newCommandData.name}
                  onChange={(e) => setNewCommandData({...newCommandData, name: e.target.value})}
                  placeholder="e.g. 'Turn on lights'"
                />
              </div>
              <div className="form-group">
                <label>Value (Integer)</label>
                <input
                  type="number"
                  value={newCommandData.value}
                  onChange={(e) => setNewCommandData({...newCommandData, value: e.target.value})}
                  placeholder="Encrypted integer value"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newCommandData.description}
                  onChange={(e) => setNewCommandData({...newCommandData, description: e.target.value})}
                  placeholder="Command description..."
                />
              </div>
              <button 
                onClick={createCommand}
                disabled={creatingCommand || isEncrypting}
              >
                {creatingCommand || isEncrypting ? "Encrypting..." : "Create Command"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>Voice Command Statistics</h2>
            <div className="stats-grid">
              <div className="stat-card">
                <h3>Total Commands</h3>
                <p>{commands.length}</p>
              </div>
              <div className="stat-card">
                <h3>Verified</h3>
                <p>{commands.filter(c => c.isVerified).length}</p>
              </div>
              <div className="stat-card">
                <h3>Your Commands</h3>
                <p>{commands.filter(c => c.creator === address).length}</p>
              </div>
            </div>
            <div className="fhe-process">
              <h3>FHE Encryption Process</h3>
              <div className="process-steps">
                <div className="step">
                  <div className="step-number">1</div>
                  <p>Voice command encrypted</p>
                </div>
                <div className="step">
                  <div className="step-number">2</div>
                  <p>Encrypted data stored</p>
                </div>
                <div className="step">
                  <div className="step-number">3</div>
                  <p>Offline decryption</p>
                </div>
                <div className="step">
                  <div className="step-number">4</div>
                  <p>On-chain verification</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {selectedCommand && (
        <div className="command-modal">
          <div className="modal-content">
            <button className="close-modal" onClick={() => setSelectedCommand(null)}>×</button>
            <h2>{selectedCommand.name}</h2>
            <p className="command-description">{selectedCommand.description}</p>
            
            <div className="command-details">
              <div className="detail">
                <span>Creator:</span>
                <p>{selectedCommand.creator.substring(0, 6)}...{selectedCommand.creator.substring(38)}</p>
              </div>
              <div className="detail">
                <span>Created:</span>
                <p>{new Date(selectedCommand.timestamp * 1000).toLocaleString()}</p>
              </div>
              <div className="detail">
                <span>Status:</span>
                <p>{selectedCommand.isVerified ? "Verified" : "Encrypted"}</p>
              </div>
            </div>

            <div className="command-value">
              <h3>Encrypted Value</h3>
              {selectedCommand.isVerified ? (
                <p className="decrypted-value">
                  Decrypted: {selectedCommand.decryptedValue}
                </p>
              ) : (
                <p className="encrypted-value">
                  🔒 FHE Encrypted Integer
                </p>
              )}
              <button 
                onClick={async () => {
                  const value = await decryptCommand(selectedCommand.id);
                  if (value !== null) {
                    setSelectedCommand({
                      ...selectedCommand,
                      decryptedValue: value,
                      isVerified: true
                    });
                  }
                }}
                disabled={isDecrypting || selectedCommand.isVerified}
              >
                {isDecrypting 
                  ? "Decrypting..." 
                  : selectedCommand.isVerified 
                    ? "✅ Verified" 
                    : "🔓 Decrypt"}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`transaction-notice ${transactionStatus.status}`}>
          <div className="notice-content">
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <div className="check">✓</div>}
            {transactionStatus.status === "error" && <div className="cross">✗</div>}
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;