import React, { useState, useEffect, useRef } from 'react';
import type { MentionUser } from '../types';
import { getInitials } from '../utils/helpers';
import { useTaskBoardContext } from '../context/TaskBoardProvider';
import { toDisplayText, toStoredText } from './MentionText';

export interface MentionTextareaProps {
  value: string;
  onChange: (val: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  disabled?: boolean;
}

export function MentionTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder = "",
  rows = 2,
  className = "",
  disabled = false,
}: MentionTextareaProps) {
  const { service, features } = useTaskBoardContext();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mentionMapRef = useRef<Map<string, string>>(new Map());

  // Initialize mention map from existing value
  useEffect(() => {
    const re = /@\[(.*?)\]\((.*?)\)/g;
    let match;
    while ((match = re.exec(value)) !== null) {
      mentionMapRef.current.set(match[1], match[2]);
    }
  }, []);

  // Fetch users when mention query changes
  useEffect(() => {
    if (!features.mentions || mentionQuery === null) {
      setMentionUsers([]);
      return;
    }
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(async () => {
      try {
        const users = await service.searchMentionUsers(mentionQuery);
        setMentionUsers(users);
        setSelectedIndex(0);
      } catch {
        setMentionUsers([]);
      }
    }, 150);
    return () => { if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current); };
  }, [mentionQuery, service, features.mentions]);

  const displayValue = toDisplayText(value);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newDisplay = e.target.value;
    const stored = toStoredText(newDisplay, mentionMapRef.current);
    onChange(stored);

    const cursorPos = e.target.selectionStart;
    const textBefore = newDisplay.slice(0, cursorPos);
    const atIndex = textBefore.lastIndexOf("@");

    if (atIndex >= 0) {
      const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || atIndex === 0) {
        const query = textBefore.slice(atIndex + 1);
        if (!query.includes(" ") || query.length <= 20) {
          setMentionQuery(query);
          setMentionStart(atIndex);
          return;
        }
      }
    }
    setMentionQuery(null);
  };

  const insertMention = (user: MentionUser) => {
    const display = toDisplayText(value);
    const before = display.slice(0, mentionStart);
    const after = display.slice(mentionStart + 1 + (mentionQuery?.length || 0));
    mentionMapRef.current.set(user.name, user.username);
    const newDisplay = before + `@${user.name} ` + after;
    const stored = toStoredText(newDisplay, mentionMapRef.current);
    onChange(stored);
    setMentionQuery(null);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const pos = before.length + user.name.length + 2;
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionUsers.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, mentionUsers.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(mentionUsers[selectedIndex]); return; }
      if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); return; }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={displayValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={rows}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
      />
      {mentionQuery !== null && mentionUsers.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-64 bg-white border border-neutral-200 rounded-lg shadow-lg z-50 py-1 max-h-48 overflow-y-auto">
          <div className="px-2.5 py-1.5 text-[10px] font-medium text-neutral-400 uppercase tracking-wide">People</div>
          {mentionUsers.map((user, i) => (
            <button
              key={user.username}
              onClick={() => insertMention(user)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left hover:bg-neutral-50 ${
                i === selectedIndex ? "bg-neutral-50" : ""
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-[#FF5E00] flex items-center justify-center shrink-0">
                <span className="text-[9px] font-medium text-white">{getInitials(user.name)}</span>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-neutral-800 truncate">{user.name}</div>
                <div className="text-[10px] text-neutral-400 truncate">{user.email}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
