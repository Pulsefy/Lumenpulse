"use client"

import { ReactNode, createContext, useContext, useState, useEffect } from "react";
import { isConnected, getAddress, signTransaction } from "@stellar/freighter-api";

interface StellarWalletContextType {
  address: string | null;
  isConnected: boolean;
  connect: () => Promise<string | null>;
  disconnect: () => void;
}

const StellarWalletContext = createContext<StellarWalletContextType | undefined>(undefined);

export function useStellarWallet() {
  const context = useContext(StellarWalletContext);
  if (context === undefined) {
    throw new Error("useStellarWallet must be used within a StellarWalletProvider");
  }
  return context;
}

export function StellarProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);

  // Check for existing connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const connection = await isConnected();
        if (connection && typeof connection === 'object' && 'isConnected' in connection && connection.isConnected) {
          const result = await getAddress();
          if (result && 'address' in result && result.address) {
            setAddress(result.address);
          }
        }
      } catch (error) {
        console.error("Error checking Stellar connection:", error);
      }
    };
    checkConnection();
  }, []);

  const connect = async () => {
    try {
      const connection = await isConnected();
      const isFreighterConnected = connection && typeof connection === 'object' && 'isConnected' in connection && connection.isConnected;
      
      if (isFreighterConnected) {
        const result = await getAddress();
        if (result && 'address' in result && result.address) {
          setAddress(result.address);
          return result.address;
        }
      } else {
        // In a real app, you might want to prompt the user to install Freighter or request access
        console.error("Freighter is not installed or connected");
      }
    } catch (error) {
      console.error("Failed to connect to Freighter:", error);
    }
    return null;
  };

  const disconnect = () => {
    setAddress(null);
  };

  return (
    <StellarWalletContext.Provider
      value={{
        address,
        isConnected: !!address,
        connect,
        disconnect,
      }}
    >
      {children}
    </StellarWalletContext.Provider>
  );
}

