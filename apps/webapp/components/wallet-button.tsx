'use client';

import { useState, useEffect } from 'react';
import { Wallet, LogOut, X } from 'lucide-react';
import { useStellarWallet } from '@/app/providers';

interface WalletButtonProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function WalletButton({
  className = '',
  size = 'md',
}: WalletButtonProps) {
  const { address, isConnected, connect, disconnect } = useStellarWallet();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    // Cleanup on unmount
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen]);

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  const handleConnect = async () => {
    const publicKey = await connect();
    if (publicKey) {
      setIsModalOpen(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const truncateAddress = (addr: string | null) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // Handle backdrop click to close modal
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setIsModalOpen(false);
    }
  };

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        setIsModalOpen(false);
      }
    };

    if (isModalOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isModalOpen]);

  if (!isClient) {
    return null;
  }

  return (
    <>
      {isConnected ? (
        <div className='flex items-center gap-2'>
          <button
            onClick={() => {}}
            className={`relative group rounded-lg font-medium flex items-center gap-2 transition-all duration-300 ${sizeClasses[size]} ${className}`}
          >
            <span className='absolute inset-0 rounded-lg bg-black/30 backdrop-blur-sm'></span>
            <span className='absolute inset-0 rounded-lg border-2 border-[#db74cf] group-hover:border-opacity-100 border-opacity-70 transition-all'></span>
            <span className='absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-md bg-[#db74cf]/10'></span>
            <span className='relative z-10 flex items-center justify-center gap-2 text-white'>
              <Wallet
                className={`text-primary group-hover:text-white transition-colors ${
                  size === 'sm'
                    ? 'w-3.5 h-3.5'
                    : size === 'lg'
                    ? 'w-5 h-5'
                    : 'w-4 h-4'
                }`}
              />
              {truncateAddress(address)}
            </span>
          </button>
          <button
            onClick={handleDisconnect}
            className='relative group rounded-lg font-medium flex items-center p-2 transition-all duration-300 bg-black/30 backdrop-blur-sm border-2 border-red-500/70 hover:border-red-500'
          >
            <LogOut className='w-4 h-4 text-red-500' />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setIsModalOpen(true)}
          className={`relative group rounded-lg font-medium flex items-center gap-2 transition-all duration-300 ${sizeClasses[size]} ${className}`}
        >
          <span className='absolute inset-0 rounded-lg bg-black/30 backdrop-blur-sm'></span>
          <span className='absolute inset-0 rounded-lg border-2 border-[#db74cf] group-hover:border-opacity-100 border-opacity-70 transition-all'></span>
          <span className='absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-md bg-[#db74cf]/10'></span>
          <span className='relative z-10 flex items-center justify-center gap-2 text-white'>
            <Wallet
              className={`text-primary group-hover:text-white transition-colors ${
                size === 'sm'
                  ? 'w-3.5 h-3.5'
                  : size === 'lg'
                  ? 'w-5 h-5'
                  : 'w-4 h-4'
              }`}
            />
            Connect Wallet
          </span>
        </button>
      )}

      {/* Enhanced Modal with perfect centering and strong backdrop blur */}
      {isModalOpen && (
        <div 
          className='fixed inset-0 z-[9999]'
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            minHeight: '100vh',
            minWidth: '100vw'
          }}
          onClick={handleBackdropClick}
        >
          {/* Modal Content */}
          <div 
            className='relative bg-black/95 border-2 border-[#db74cf]/50 rounded-2xl p-8 w-full max-w-md shadow-2xl transform transition-all duration-300 ease-out'
            style={{
              backdropFilter: 'blur(30px)',
              WebkitBackdropFilter: 'blur(30px)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(219, 116, 207, 0.2), 0 0 50px rgba(219, 116, 207, 0.1)',
              position: 'relative',
              margin: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Stronger gradient background overlay */}
            <div className='absolute inset-0 bg-gradient-to-br from-[#db74cf]/15 via-black/50 to-blue-500/15 rounded-2xl'></div>
            
            {/* Close button */}
            <button
              onClick={() => setIsModalOpen(false)}
              className='absolute top-4 right-4 text-white/70 hover:text-white transition-all duration-200 hover:bg-white/10 rounded-full p-2 group z-20'
              aria-label='Close modal'
            >
              <X className='w-5 h-5 group-hover:rotate-90 transition-transform duration-200' />
            </button>
            
            {/* Modal Header */}
            <div className='relative z-10 text-center mb-8'>
              <div className='inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-[#db74cf] to-blue-500 rounded-full mb-4 shadow-lg'>
                <Wallet className='w-8 h-8 text-white' />
              </div>
              <h2 className='text-2xl font-bold text-white mb-2'>
                Connect Wallet
              </h2>
              <p className='text-gray-300 text-sm'>
                Choose your preferred wallet to connect to Lumenpulse
              </p>
            </div>
            
            {/* Wallet Options */}
            <div className='relative z-10 space-y-3'>
              <button
                onClick={handleConnect}
                className='w-full flex items-center justify-between px-6 py-4 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:border-[#db74cf]/50 hover:shadow-lg transition-all duration-200 group'
              >
                <div className='flex items-center gap-3'>
                  <div className='w-8 h-8 bg-gradient-to-r from-[#db74cf]/30 to-blue-500/30 rounded-lg flex items-center justify-center'>
                    <Wallet className='w-4 h-4 text-[#db74cf]' />
                  </div>
                  <span className='font-medium text-lg text-white group-hover:text-[#db74cf] transition-colors'>
                    Freighter
                  </span>
                </div>
              </button>
            </div>
            
            {/* Footer */}
            <div className='relative z-10 mt-6 pt-4 border-t border-white/20'>
              <p className='text-xs text-gray-400 text-center'>
                By connecting a wallet, you agree to our{' '}
                <span className='text-[#db74cf] hover:underline cursor-pointer transition-colors'>
                  Terms of Service
                </span>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

