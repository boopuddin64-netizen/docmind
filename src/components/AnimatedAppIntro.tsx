import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ShieldCheck, Scan, Bell, CheckCircle2 } from 'lucide-react';

interface AnimatedAppIntroProps {
  onComplete: () => void;
}

export const AnimatedAppIntro: React.FC<AnimatedAppIntroProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Initializing DocuMind AI Engine...');
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Progress animation timeline
    const timer1 = setTimeout(() => {
      setProgress(35);
      setStatusText('Loading Encrypted Document Vault...');
    }, 400);

    const timer2 = setTimeout(() => {
      setProgress(75);
      setStatusText('Checking Live Schedule & Device Alerts...');
    }, 900);

    const timer3 = setTimeout(() => {
      setProgress(100);
      setStatusText('System Ready!');
    }, 1400);

    const timer4 = setTimeout(() => {
      setIsExiting(true);
    }, 1800);

    const timer5 = setTimeout(() => {
      onComplete();
    }, 2200);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      clearTimeout(timer5);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {!isExiting && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.05 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-between p-6 bg-[#07131e] text-white select-none overflow-hidden"
        >
          {/* Subtle Ambient Background Gradients */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-sky-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 translate-y-1/2 w-[300px] h-[300px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Top Branding / Security Badge */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="pt-6 flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-950/80 border border-sky-800/50 text-sky-300 text-[11px] font-extrabold tracking-wider uppercase shadow-lg backdrop-blur-md"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
            <span>AI Document Engine & Vault</span>
          </motion.div>

          {/* Center Brand Identity */}
          <div className="flex flex-col items-center text-center my-auto space-y-6 relative z-10 max-w-sm">
            {/* Animated Logo Container */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="relative group cursor-pointer"
              onClick={() => {
                setIsExiting(true);
                setTimeout(onComplete, 300);
              }}
            >
              {/* Outer Pulsing Glow */}
              <div className="absolute -inset-3 rounded-3xl bg-gradient-to-r from-[#0284c7] via-sky-400 to-[#0369a1] opacity-60 blur-md animate-pulse" />

              {/* Main App Logo Card */}
              <div className="relative w-28 h-28 rounded-3xl overflow-hidden border-2 border-sky-300/40 bg-[#0c1e2e] shadow-2xl flex items-center justify-center p-1">
                <img
                  src="/docmind_logo.jpg"
                  alt="DocuMind Logo"
                  className="w-full h-full object-cover rounded-2xl"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // Fallback icon if image fails
                    e.currentTarget.style.display = 'none';
                  }}
                />

                {/* Laser Scanning Bar Effect */}
                <motion.div
                  animate={{ y: ['-100%', '200%'] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-sky-300 to-transparent shadow-[0_0_12px_#38bdf8]"
                />
              </div>

              {/* Corner AI Sparkle Badge */}
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-[#0284c7] border-2 border-[#07131e] flex items-center justify-center shadow-lg">
                <Sparkles className="w-4 h-4 text-white animate-spin" style={{ animationDuration: '4s' }} />
              </div>
            </motion.div>

            {/* App Name & Tagline */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="space-y-1.5"
            >
              <h1 className="text-3xl font-black text-white tracking-tight flex items-center justify-center gap-2">
                <span>DocuMind</span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-[#0284c7] text-white font-extrabold tracking-widest uppercase">
                  AI
                </span>
              </h1>
              <p className="text-xs text-sky-200/80 font-semibold max-w-xs leading-relaxed">
                Smart AI Scanner & Life Reminder Manager
              </p>
            </motion.div>

            {/* Progress Bar & Status Text */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.35 }}
              className="w-full space-y-2.5 pt-2"
            >
              <div className="w-full h-2 bg-sky-950/80 border border-sky-800/50 rounded-full overflow-hidden p-0.5 shadow-inner">
                <motion.div
                  className="h-full bg-gradient-to-r from-[#0284c7] via-sky-400 to-emerald-400 rounded-full shadow-[0_0_8px_#38bdf8]"
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: 'easeOut', duration: 0.4 }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-sky-300/80 font-mono px-1">
                <span className="truncate pr-2">{statusText}</span>
                <span className="font-bold text-sky-200">{progress}%</span>
              </div>
            </motion.div>
          </div>

          {/* Bottom Features Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.45 }}
            className="w-full max-w-md grid grid-cols-3 gap-2 pt-4 border-t border-sky-900/40 text-[10px] text-sky-300/70 font-semibold text-center"
          >
            <div className="flex flex-col items-center gap-1 p-1">
              <Scan className="w-3.5 h-3.5 text-sky-400" />
              <span>AI Extraction</span>
            </div>
            <div className="flex flex-col items-center gap-1 p-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>AES-256 Vault</span>
            </div>
            <div className="flex flex-col items-center gap-1 p-1">
              <Bell className="w-3.5 h-3.5 text-amber-400" />
              <span>Pop-Up Alerts</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
