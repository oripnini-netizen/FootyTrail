// client/src/components/GuessInput.jsx
import React, { useEffect, useRef, useState } from 'react';
import { suggestNames } from '../api';

/**
 * GuessInput
 * - Autocomplete suggestions are GLOBAL (entire players_seasons), not filtered.
 * - No age shown in the suggestions.
 */
export default function GuessInput({
  disabled,
  onSubmitGuess, // (guessText) => void
}) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);

  // Debounce keystrokes
  useEffect(() => {
    const t = setTimeout(() => setQuery(value.trim()), 120);
    return () => clearTimeout(t);
  }, [value]);

  // Fetch suggestions (GLOBAL, not filtered)
  useEffect(() => {
    let cancel = false;
    async function run() {
      if (query.length < 2) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      try {
        const { suggestions } = await suggestNames({ query, limit: 12 });
        if (!cancel) {
          setSuggestions(suggestions || []);
          setOpen((suggestions || []).length > 0);
          setHighlight(-1);
        }
      } catch {
        if (!cancel) {
          setSuggestions([]);
          setOpen(false);
        }
      }
    }
    run();
    return () => { cancel = true; };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function onKeyDown(e) {
    if (!open) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitManual();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (highlight >= 0) {
        const s = suggestions[highlight];
        choose(s.displayName);
        e.preventDefault();
      } else {
        submitManual();
      }
    }
  }

  function choose(name) {
    setValue(name);
    setOpen(false);
    onSubmitGuess && onSubmitGuess(name);
  }

  function submitManual() {
    const text = value.trim();
    if (text) onSubmitGuess && onSubmitGuess(text);
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Type a player name..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
        />
        <button
          onClick={submitManual}
          disabled={disabled}
          className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
        >
          Guess
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={() => choose(s.displayName)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                i === highlight ? 'bg-gray-100' : ''
              }`}
            >
              {s.photo ? (
                <img
                  src={s.photo}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover"
                  onError={(ev) => { ev.currentTarget.style.visibility = 'hidden'; }}
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-gray-200" />
              )}
              <div className="flex flex-col">
                <span className="font-medium">{s.displayName}</span>
                {/* No age */}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
