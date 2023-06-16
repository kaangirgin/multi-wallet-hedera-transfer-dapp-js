import { BladeSigner, HederaNetwork } from "@bladelabs/blade-web3.js";
import { ContractExecuteTransaction, TokenAssociateTransaction, TransferTransaction } from "@hashgraph/sdk";
import EventEmitter from "events";
import { useCallback, useContext, useEffect, useState } from "react";
import { BladeContext } from "../../../contexts/BladeContext";

const env = HederaNetwork.Testnet;
const bladeLocalStorage = "usedBladeForWalletPairing";

const appMetadata = {
  network: env,
  dAppCode: "hederaCraTemplate",
};
export const bladeSigner = new BladeSigner();

// We need an event emitter to trigger syncWithBladeSession and syncWithBladeDisconnected
// from outside of the BladeClient component.
//
// The BladeWallet.disconnect() method fires the syncDisconnect event, which triggers
// the syncWithBladeDisconnected callback in the BladeClient component.
//
// The connectToBladeWallet() function fires the syncSession event, which triggers
// the syncWithBladeSession callback in the BladeClient component.
const syncWithBladeEvent = new EventEmitter();

class BladeWallet {
  async transferHBAR(toAddress, amount) {
    const transferHBARTransaction = await new TransferTransaction()
      .addHbarTransfer(bladeSigner.getAccountId().toString(), -amount)
      .addHbarTransfer(toAddress, amount)
      .freezeWithSigner(bladeSigner);

    const transactionId = await transferHBARTransaction.executeWithSigner(bladeSigner)
      .then(txResult => txResult.transactionId)
      .catch((error) => {
        console.log(error.message ? error.message : error);
        return null;
      });;
    return transactionId;
  }

  async transferFungibleToken(toAddress, tokenId, amount) {
    const transferTokenTransaction = await new TransferTransaction()
      .addTokenTransfer(tokenId, bladeSigner.getAccountId().toString(), -amount)
      .addTokenTransfer(tokenId, toAddress, amount)
      .freezeWithSigner(bladeSigner);

    const transactionId = await transferTokenTransaction.executeWithSigner(bladeSigner)
      .then(txResult => txResult.transactionId)
      .catch((error) => {
        console.log(error.message ? error.message : error);
        return null;
      });
    return transactionId;
  }

  async transferNonFungibleToken(toAddress, tokenId, serialNumber) {
    const transferTokenTransaction = await new TransferTransaction()
      .addNftTransfer(tokenId, serialNumber, bladeSigner.getAccountId().toString(), toAddress)
      .freezeWithSigner(bladeSigner);

    const transactionId = await transferTokenTransaction.executeWithSigner(bladeSigner)
      .then(txResult => txResult.transactionId)
      .catch((error) => {
        console.log(error.message ? error.message : error);
        return null;
      });
    return transactionId;
  }

  async associateToken(tokenId) {
    const associateTokenTransaction = await new TokenAssociateTransaction()
      .setAccountId(bladeSigner.getAccountId().toString())
      .setTokenIds([tokenId])
      .freezeWithSigner(bladeSigner);

    const transactionId = await associateTokenTransaction.executeWithSigner(bladeSigner)
      .then(txResult => txResult.transactionId)
      .catch((error) => {
        console.log(error.message ? error.message : error);
        return null;
      });
    return transactionId;
  }

  // Purpose: build contract execute transaction and send to hashconnect for signing and execution
  // Returns: Promise<TransactionId | null>
  async executeContractFunction(contractId, functionName, functionParameters, gasLimit) {
    // Grab the topic and account to sign from the last pairing event
    const tx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(gasLimit)
      .setFunction(functionName, functionParameters.buildHAPIParams());

    const txFrozen = await tx.freezeWithSigner(bladeSigner);
    const transactionId = await txFrozen.executeWithSigner(bladeSigner)
      .then(txResult => txResult.transactionId)
      .catch((error) => {
        console.log(error.message ? error.message : error);
        return null;
      });

    // in order to read the contract call results, you will need to query the contract call's results form a mirror node using the transaction id
    // after getting the contract call results, use ethers and abi.decode to decode the call_result
    return transactionId;
  }
  disconnect() {
    syncWithBladeEvent.emit("syncDisconnect");
    localStorage.removeItem(bladeLocalStorage);
  };
};
export const bladeWallet = new BladeWallet();

export const connectToBladeWallet = async (skipKillSession = false) => {
  try {
    if (!skipKillSession) {
      await bladeSigner.killSession(); // kill any existing session to allow pairing a new account
    }
    await bladeSigner.createSession(appMetadata);
    syncWithBladeEvent.emit("syncSession");
    localStorage.setItem(bladeLocalStorage, "true");
  } catch (error) {
    console.log(error);
  }
};

export const BladeClient = () => {
  const [usedBlade, setUsedBlade] = useState(false);

  // use the BladeContext to keep track of the hashpack account and connection
  const { setAccountId, setIsConnected } = useContext(BladeContext);

  // sync with blade state with the context so the context is aware of connected account id
  const syncWithBladeSession = useCallback(() => {
    try {
      const accountId = bladeSigner.getAccountId();
      if (accountId) {
        setAccountId(accountId.toString());
        setIsConnected(true);
      } else {
        setAccountId("");
        setIsConnected(false);
      }
    } catch (error) {
      console.log(error);
      setAccountId("");
      setIsConnected(false);
    };
  }, [setIsConnected, setAccountId]);
  const syncWithBladeDisconnected = useCallback(() => {
    setAccountId("");
    setIsConnected(false);
  }, [setIsConnected, setAccountId]);

  // sync the blade state with the context
  useEffect(() => {
    const sessionCallback = () => {
      syncWithBladeSession();
    };
    const disconnectCallback = () => {
      syncWithBladeDisconnected();
    };

    if (usedBlade) {
      connectToBladeWallet(true);
    }

    syncWithBladeEvent.on("syncSession", sessionCallback)
    syncWithBladeEvent.on("syncDisconnect", disconnectCallback)

    return () => {
      syncWithBladeEvent.off("syncSession", sessionCallback);
      syncWithBladeEvent.off("syncDisconnect", disconnectCallback)
    }
  }, [syncWithBladeSession, syncWithBladeDisconnected, usedBlade]);

  useEffect(() => {
    setUsedBlade(localStorage.getItem(bladeLocalStorage) === "true");
  }, []);

  return null;
};