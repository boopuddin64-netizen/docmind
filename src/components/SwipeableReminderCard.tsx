import React, { useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import {
  CheckCircle2,
  Clock,
  Download,
  ChevronRight,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { Reminder } from '../types';

interface SwipeableReminderCardProps {
  rem: Reminder;
  onSelectReminder: (rem: Reminder) => void;
  onToggleComplete: (id: string) => void;
  onDeleteReminder: (id: string) => void;
  exportCalendar: (rem: Reminder) => void;
}

export const SwipeableReminderCard: React.FC<SwipeableReminderCardProps> = ({
  rem,
  onSelectReminder,
  onToggleComplete,
  onDeleteReminder,
  exportCalendar,
}) => {
  const x = useMotionValue(0);
  const [isSwiping, setIsSwiping] = useState(false);

  // Background color opacity transforms based on swipe direction
  const completeOpacity = useTransform(x, [20, 90], [0, 1]);
  const deleteOpacity = useTransform(x, [-90, -20], [1, 0]);

  const handleDragEnd = (_: any, info: { offset: { x: number }; velocity: { x: number } }) => {
    setIsSwiping(false);
    const swipeThreshold = 90;

    if (info.offset.x > swipeThreshold) {
      onToggleComplete(rem.id);
    } else if (info.offset.x < -swipeThreshold) {
      onDeleteReminder(rem.id);
    }
  };

  return (
    <div className="relative rounded-2xl overflow-hidden my-1 shadow-2xs select-none">
      {/* Background Actions Revealed on Swipe */}

      {/* Swipe Right Background -> Complete / Toggle */}
      <motion.div
        style={{ opacity: completeOpacity }}
        className={`absolute inset-0 flex items-center justify-start pl-6 font-bold text-white transition-colors ${
          rem.isCompleted ? 'bg-[#005faf]' : 'bg-[#006e58]'
        }`}
      >
        <div className="flex items-center gap-2">
          {rem.isCompleted ? (
            <>
              <RotateCcw className="w-5 h-5" />
              <span className="text-xs tracking-wide">Set Active</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5" />
              <span className="text-xs tracking-wide">Mark Completed!</span>
            </>
          )}
        </div>
      </motion.div>

      {/* Swipe Left Background -> Delete */}
      <motion.div
        style={{ opacity: deleteOpacity }}
        className="absolute inset-0 bg-[#ba1a1a] flex items-center justify-end pr-6 font-bold text-white"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-wide">Delete</span>
          <Trash2 className="w-5 h-5" />
        </div>
      </motion.div>

      {/* Foreground Draggable Card */}
      <motion.div
        style={{ x }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.45}
        onDragStart={() => setIsSwiping(true)}
        onDragEnd={handleDragEnd}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        className={`bg-white p-4 border transition-colors relative z-10 rounded-2xl ${
          rem.isCompleted
            ? 'border-[#e1e3e4] opacity-80'
            : 'border-[#e1e3e4] hover:border-[#00342b]'
        }`}
        id={`reminder-card-${rem.id}`}
      >
        {/* Category Accent Stripe */}
        <div
          className={`absolute left-0 top-0 bottom-0 w-2 rounded-l-2xl ${
            rem.category === 'Bills & Invoices'
              ? 'bg-[#ba1a1a]'
              : rem.category === 'Contracts & Legal'
              ? 'bg-[#005faf]'
              : rem.category === 'Vehicle & Home'
              ? 'bg-[#f09e34]'
              : rem.category === 'Work & Study'
              ? 'bg-[#7a309f]'
              : rem.category === 'Medical' || rem.category === 'Dental'
              ? 'bg-[#004d40]'
              : 'bg-[#00342b]'
          }`}
        />

        <div className="pl-3">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#f2f4f5] text-[#00342b]">
                  {rem.category}
                </span>
                <span className="text-xs font-medium text-[#005faf] bg-[#d4e3ff] px-2 py-0.5 rounded">
                  {rem.patientName}
                </span>
              </div>

              <h3
                onClick={() => {
                  if (!isSwiping) onSelectReminder(rem);
                }}
                className={`text-base font-bold text-[#191c1d] hover:text-[#005faf] cursor-pointer ${
                  rem.isCompleted ? 'line-through text-[#707975]' : ''
                }`}
              >
                {rem.eventTitle}
              </h3>
            </div>

            <button
              onClick={() => onToggleComplete(rem.id)}
              className={`p-1.5 rounded-full transition-colors shrink-0 ${
                rem.isCompleted
                  ? 'bg-[#afefdd] text-[#00342b]'
                  : 'bg-[#f2f4f5] text-[#707975] hover:bg-[#e1e3e4]'
              }`}
              title={rem.isCompleted ? 'Mark as Active' : 'Mark as Complete'}
              id={`btn-complete-${rem.id}`}
            >
              <CheckCircle2 className="w-5 h-5" />
            </button>
          </div>

          {/* Provider / Institution Details */}
          <p className="text-xs font-semibold text-[#3f4945] mb-1">
            {rem.hospitalName}
          </p>

          <p className="text-xs text-[#3f4945] line-clamp-2 mb-3 bg-[#f8fafb] p-2.5 rounded-xl border border-[#f2f4f5]">
            {rem.shortNote}
          </p>

          {/* Footer Date & Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[#f2f4f5]">
            <div className="flex items-center gap-1.5 text-xs text-[#00342b] font-semibold">
              <Clock className="w-3.5 h-3.5 text-[#005faf]" />
              <span>
                {rem.appointmentDate} at {rem.appointmentTime}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => exportCalendar(rem)}
                className="p-1.5 text-[#3f4945] hover:text-[#005faf] hover:bg-[#f2f4f5] rounded-lg"
                title="Download iCal Event"
                id={`btn-export-ical-${rem.id}`}
              >
                <Download className="w-4 h-4" />
              </button>

              <button
                onClick={() => onSelectReminder(rem)}
                className="text-xs font-semibold text-[#005faf] hover:underline flex items-center gap-0.5"
              >
                <span>Details</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => onDeleteReminder(rem.id)}
                className="p-1.5 text-[#707975] hover:text-[#ba1a1a] hover:bg-[#ffdad6]/40 rounded-lg"
                title="Delete reminder"
                id={`btn-delete-${rem.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
