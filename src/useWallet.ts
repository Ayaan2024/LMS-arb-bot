import { useState, useEffect } from 'react';

declare global {
  interface Window {
    ethereum?: any;
  }
}

interface WalletState {
  address: string | null;
  connected: boolean;
  balance: string;
  chainId: number | null;
  error: string | null;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    connected: false,
    balance: '0',
    chainId: null,
    error: null,
  });

  function detectProviderName(): string {
    const eth = window.ethereum;
    if (!eth) return 'Not installed';
    if (eth.isTrust || eth.isTrustWallet) return 'Trust Wallet';
    if (eth.isMetaMask) return 'MetaMask';
    return 'Web3 Wallet';
  }

  async function fetchBalance(address: string): Promise<string> {
    try {
      const hex = await window.ethereum.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      });
      const wei = parseInt(hex, 16);
      return (wei / 1e18).toFixed(4);
    } catch {
      return '0';
    }
  }

  async function loadAccount(address: string) {
    const chainHex = await window.ethereum.request({ method: 'eth_chainId' });
    const chainId = parseInt(chainHex, 16);
    const balance = await fetchBalance(address);
    setWallet({
      address,
      connected: true,
      balance,
      chainId,
      error: null,
    });
  }

  // Auto-connect if already authorized
  useEffect(() => {
    if (!window.ethereum) return;

    window.ethereum.request({ method: 'eth_accounts' })
      .then((accounts: string[]) => {
        if (accounts.length > 0) loadAccount(accounts[0]);
      })
      .catch(() => {});

    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setWallet({ address: null, connected: false, balance: '0', chainId: null, error: null });
      } else {
        loadAccount(accounts[0]);
      }
    };

    const onChainChanged = () => {
      if (wallet.address) loadAccount(wallet.address);
    };

    window.ethereum.on?.('accountsChanged', onAccountsChanged);
    window.ethereum.on?.('chainChanged', onChainChanged);

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum?.removeListener?.('chainChanged', onChainChanged);
    };
  }, []);

  async function connectWallet(): Promise<string | null> {
    if (!window.ethereum) {
      setWallet(prev => ({ ...prev, error: 'MetaMask or Trust Wallet not found. Please install one.' }));
      return null;
    }
    try {
      const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts.length === 0) return null;
      await loadAccount(accounts[0]);
      return accounts[0];
    } catch (e: any) {
      setWallet(prev => ({ ...prev, error: e?.message || 'Connection rejected' }));
      return null;
    }
  }

  function disconnectWallet() {
    setWallet({ address: null, connected: false, balance: '0', chainId: null, error: null });
  }

  async function switchToChain(chainId: number) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      });
    } catch (e: any) {
      setWallet(prev => ({ ...prev, error: e?.message || 'Failed to switch chain' }));
    }
  }

  async function getSignature(message: string): Promise<string | null> {
    if (!wallet.address || !window.ethereum) return null;
    try {
      return await window.ethereum.request({
        method: 'personal_sign',
        params: [message, wallet.address],
      });
    } catch {
      return null;
    }
  }

  const isBSC = wallet.chainId === 56;
  const shortAddress = wallet.address
    ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    : null;
  const providerName = detectProviderName();

  return {
    ...wallet,
    connectWallet,
    disconnectWallet,
    switchToChain,
    getSignature,
    isBSC,
    shortAddress,
    providerName,
  };
}


interface WalletState {
  address: string | null;
  connected: boolean;
  balance: string;
  chainId: number | null;
  provider: any;
  signer: any;
  error: string | null;
}

export function useWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    connected: false,
    balance: '0',
    chainId: null,
    provider: null,
    signer: null,
    error: null,
  });

  // Check if wallet is already connected on mount
  useEffect(() => {
    checkWalletConnection();
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          connectWallet();
        }
      });

      window.ethereum.on('chainChanged', () => {
        window.location.reload();
      });
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners?.();
      }
    };
  }, []);

  async function checkWalletConnection() {
    try {
      if (!window.ethereum) {
        setWallet(prev => ({ ...prev, error: 'No wallet detected' }));
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.listAccounts();

      if (accounts.length > 0) {
        const account = accounts[0];
        const signer = await provider.getSigner();
        const balance = await provider.getBalance(account);
        const network = await provider.getNetwork();

        setWallet({
          address: account.address,
          connected: true,
          balance: ethers.formatEther(balance),
          chainId: Number(network.chainId),
          provider,
          signer,
          error: null,
        });
      }
    } catch (error: any) {
      setWallet(prev => ({ ...prev, error: error.message }));
    }
  }

  async function connectWallet() {
    try {
      if (!window.ethereum) {
        setWallet(prev => ({
          ...prev,
          error: 'MetaMask or Trust Wallet not installed',
        }));
        return;
      }

      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (accounts.length === 0) {
        setWallet(prev => ({ ...prev, error: 'No accounts found' }));
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const balance = await provider.getBalance(accounts[0]);
      const network = await provider.getNetwork();

      setWallet({
        address: accounts[0],
        connected: true,
        balance: ethers.formatEther(balance),
        chainId: Number(network.chainId),
        provider,
        signer,
        error: null,
      });

      return accounts[0];
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to connect wallet';
      setWallet(prev => ({ ...prev, error: errorMessage }));
      return null;
    }
  }

  async function disconnectWallet() {
    setWallet({
      address: null,
      connected: false,
      balance: '0',
      chainId: null,
      provider: null,
      signer: null,
      error: null,
    });
  }

  async function switchToChain(chainId: number) {
    try {
      const hexChainId = `0x${chainId.toString(16)}`;
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
      await checkWalletConnection();
    } catch (error: any) {
      if (error.code === 4902) {
        setWallet(prev => ({
          ...prev,
          error: `Chain ${chainId} not found. Please add it to your wallet.`,
        }));
      } else {
        setWallet(prev => ({ ...prev, error: error.message }));
      }
    }
  }

  async function getSignature(message: string) {
    try {
      if (!wallet.signer) {
        throw new Error('Wallet not connected');
      }
      return await wallet.signer.signMessage(message);
    } catch (error: any) {
      setWallet(prev => ({ ...prev, error: error.message }));
      return null;
    }
  }

  // BSC chain ID is 56
  const isBSC = wallet.chainId === 56;

  return {
    ...wallet,
    connectWallet,
    disconnectWallet,
    checkWalletConnection,
    switchToChain,
    getSignature,
    isBSC,
    shortAddress: wallet.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : null,
  };
}

// Declare ethers for global access
declare global {
  interface Window {
    ethereum: any;
  }
}
