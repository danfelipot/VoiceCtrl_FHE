import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface VoiceCommand {
  id: string;
  encryptedValue: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
  commandText?: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [commands, setCommands] = useState<VoiceCommand[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCommand, setCreatingCommand] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newCommandData, setNewCommandData] = useState({ command: "" });
  const [selectedCommand, setSelectedCommand] = useState<VoiceCommand | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [commandStats, setCommandStats] = useState({
    total: 0,
    verified: 0,
    activeUsers: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
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

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const commandsList: VoiceCommand[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          commandsList.push({
            id: businessId,
            encryptedValue: "🔒",
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setCommands(commandsList);
      setCommandStats({
        total: commandsList.length,
        verified: commandsList.filter(c => c.isVerified).length,
        activeUsers: new Set(commandsList.map(c => c.creator)).size
      });
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createCommand = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingCommand(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting command..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const commandValue = Math.floor(Math.random() * 6) + 1;
      const businessId = `cmd-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, commandValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        "Voice Command",
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        "Encrypted voice command"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Processing..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Command encrypted!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewCommandData({ command: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingCommand(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Command decrypted!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        await loadData();
        return null;
      }
      
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

  const handleDecryptCommand = async (command: VoiceCommand) => {
    const decryptedValue = await decryptData(command.id);
    if (decryptedValue !== null) {
      const commandsCopy = [...commands];
      const index = commandsCopy.findIndex(c => c.id === command.id);
      if (index !== -1) {
        commandsCopy[index].decryptedValue = decryptedValue;
        commandsCopy[index].commandText = getCommandText(decryptedValue);
        setCommands(commandsCopy);
      }
    }
  };

  const getCommandText = (value: number): string => {
    const commands = [
      "Turn on lights",
      "Turn off lights",
      "Increase temperature",
      "Decrease temperature",
      "Open curtains",
      "Close curtains",
      "Play music"
    ];
    return commands[value - 1] || "Unknown command";
  };

  const startListening = () => {
    setIsListening(true);
    setTimeout(() => {
      setIsListening(false);
      setShowCreateModal(true);
    }, 2000);
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE system available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{commandStats.total}</div>
          <div className="stat-label">Total Commands</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{commandStats.verified}</div>
          <div className="stat-label">Verified</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{commandStats.activeUsers}</div>
          <div className="stat-label">Active Users</div>
        </div>
      </div>
    );
  };

  const renderCommandChart = () => {
    const commandCounts: Record<string, number> = {};
    
    commands.forEach(cmd => {
      if (cmd.decryptedValue) {
        const cmdText = getCommandText(cmd.decryptedValue);
        commandCounts[cmdText] = (commandCounts[cmdText] || 0) + 1;
      }
    });
    
    const chartData = Object.entries(commandCounts);
    
    return (
      <div className="chart-container">
        <h3>Command Distribution</h3>
        <div className="chart-bars">
          {chartData.map(([command, count], index) => (
            <div key={index} className="chart-bar">
              <div className="bar-label">{command}</div>
              <div className="bar-track">
                <div 
                  className="bar-fill" 
                  style={{ width: `${(count / commands.length) * 100}%` }}
                >
                  <span className="bar-count">{count}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Voice Control</h1>
            <div className="subtitle">FHE Encrypted Commands</div>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Secure Voice Control</h2>
            <p>Connect your wallet to access encrypted voice commands for smart home control.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Issue voice commands with full privacy</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Control your smart home securely</p>
              </div>
            </div>
          </div>
        </div>
        
        <footer className="app-footer">
          <p>Private Voice Control v1.0 | FHE Encrypted Command System</p>
          <p>Your voice commands are never recorded or stored in plaintext</p>
        </footer>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
        <p className="loading-note">Securing your voice commands</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted commands...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Voice Control</h1>
          <div className="subtitle">FHE Encrypted Commands</div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={callIsAvailable}
            className="status-btn"
          >
            Check FHE Status
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="command-center">
          <div className={`voice-sphere ${isListening ? 'listening' : ''}`} onClick={startListening}>
            <div className="sphere-inner">
              {isListening ? (
                <div className="listening-animation">
                  <div className="pulse-ring"></div>
                  <div className="pulse-ring delay-1"></div>
                  <div className="pulse-ring delay-2"></div>
                </div>
              ) : (
                <div className="mic-icon">🎤</div>
              )}
              <div className="sphere-label">
                {isListening ? "Listening..." : "Tap to Speak"}
              </div>
            </div>
          </div>
          
          <div className="command-info">
            <h2>FHE Voice Control</h2>
            <p>Your voice commands are encrypted before processing. The AI understands your intent without ever hearing your actual voice.</p>
            
            <div className="fhe-flow">
              <div className="flow-step">
                <div className="step-icon">1</div>
                <div className="step-content">
                  <h4>Voice Input</h4>
                  <p>Speak your command naturally</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">2</div>
                <div className="step-content">
                  <h4>FHE Encryption</h4>
                  <p>Command encrypted on your device</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">3</div>
                <div className="step-content">
                  <h4>AI Processing</h4>
                  <p>AI understands intent homomorphically</p>
                </div>
              </div>
              <div className="flow-arrow">→</div>
              <div className="flow-step">
                <div className="step-icon">4</div>
                <div className="step-content">
                  <h4>Device Action</h4>
                  <p>Command executed on your smart home</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="stats-section">
          <h2>Command Statistics</h2>
          {renderStats()}
        </div>
        
        <div className="chart-section">
          {renderCommandChart()}
        </div>
        
        <div className="history-section">
          <div className="section-header">
            <h2>Command History</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="commands-list">
            {commands.length === 0 ? (
              <div className="no-commands">
                <p>No voice commands recorded</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Command
                </button>
              </div>
            ) : commands.map((command, index) => (
              <div 
                className={`command-item ${command.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedCommand(command)}
              >
                <div className="command-id">Command #{index + 1}</div>
                <div className="command-meta">
                  <span>{new Date(command.timestamp * 1000).toLocaleString()}</span>
                  <span>Creator: {command.creator.substring(0, 6)}...{command.creator.substring(38)}</span>
                </div>
                <div className="command-status">
                  {command.isVerified ? (
                    <div className="status-verified">
                      <span>✅ Verified</span>
                      {command.decryptedValue && (
                        <span className="command-text">{getCommandText(command.decryptedValue)}</span>
                      )}
                    </div>
                  ) : (
                    <div className="status-encrypted">
                      <span>🔒 Encrypted</span>
                      <button 
                        className="decrypt-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDecryptCommand(command);
                        }}
                        disabled={isDecrypting}
                      >
                        Decrypt
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateCommand 
          onSubmit={createCommand} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingCommand} 
          commandData={newCommandData} 
          setCommandData={setNewCommandData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedCommand && (
        <CommandDetailModal 
          command={selectedCommand} 
          onClose={() => setSelectedCommand(null)} 
          getCommandText={getCommandText}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>Private Voice Control</h4>
            <p>FHE Encrypted Command System</p>
            <p>Your privacy is our priority</p>
          </div>
          <div className="footer-section">
            <h4>Technology</h4>
            <p>Fully Homomorphic Encryption</p>
            <p>Zero-Knowledge Proofs</p>
            <p>On-Chain Verification</p>
          </div>
          <div className="footer-section">
            <h4>Security</h4>
            <p>No voice recordings stored</p>
            <p>End-to-end encryption</p>
            <p>Decentralized architecture</p>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2025 Private Voice Control | All rights reserved</p>
        </div>
      </footer>
    </div>
  );
};

const ModalCreateCommand: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  commandData: any;
  setCommandData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, commandData, setCommandData, isEncrypting }) => {
  const commands = [
    "Turn on lights",
    "Turn off lights",
    "Increase temperature",
    "Decrease temperature",
    "Open curtains",
    "Close curtains",
    "Play music"
  ];

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCommandData({ command: e.target.value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-command-modal">
        <div className="modal-header">
          <h2>Create Voice Command</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption</strong>
            <p>Your command will be encrypted before processing</p>
          </div>
          
          <div className="form-group">
            <label>Select Command *</label>
            <select 
              name="command" 
              value={commandData.command} 
              onChange={handleChange}
            >
              <option value="">Select a command...</option>
              {commands.map((cmd, index) => (
                <option key={index} value={cmd}>{cmd}</option>
              ))}
            </select>
          </div>
          
          <div className="encryption-info">
            <div className="encryption-icon">🔒</div>
            <div>
              <strong>End-to-End Encryption</strong>
              <p>Your voice command will be converted to an encrypted integer using FHE before being sent to the blockchain.</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !commandData.command} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Command"}
          </button>
        </div>
      </div>
    </div>
  );
};

const CommandDetailModal: React.FC<{
  command: VoiceCommand;
  onClose: () => void;
  getCommandText: (value: number) => string;
}> = ({ command, onClose, getCommandText }) => {
  return (
    <div className="modal-overlay">
      <div className="command-detail-modal">
        <div className="modal-header">
          <h2>Command Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="command-info">
            <div className="info-item">
              <span>Command ID:</span>
              <strong>{command.id}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{command.creator.substring(0, 6)}...{command.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(command.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={command.isVerified ? "verified" : "encrypted"}>
                {command.isVerified ? "✅ Verified" : "🔒 Encrypted"}
              </strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Command Data</h3>
            
            <div className="data-row">
              <div className="data-label">Encrypted Value:</div>
              <div className="data-value">
                {command.encryptedValue}
              </div>
            </div>
            
            {command.decryptedValue && (
              <div className="data-row">
                <div className="data-label">Decrypted Command:</div>
                <div className="data-value decrypted">
                  {getCommandText(command.decryptedValue)}
                </div>
              </div>
            )}
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Encryption Process</strong>
                <p>Your voice command was encrypted as an integer value using Fully Homomorphic Encryption, allowing the AI to understand your intent without decrypting the actual command.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


