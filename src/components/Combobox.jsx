// Lightweight free-text combobox.
// - User can type anything (free-text).
// - As they type, options whose label contains the substring are shown.
// - Click an option to fill the field. Otherwise the typed value is used as-is.

import { useEffect, useMemo, useRef, useState } from "react";

export default function Combobox({
  label,
  value,
  onChange,
  options = [],
  placeholder,
  autoFocus
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = (value || "").toLowerCase().trim();
    if (!q) return options.slice(0, 8);
    return options
      .filter(o => o.toLowerCase().includes(q) && o.toLowerCase() !== q)
      .slice(0, 8);
  }, [options, value]);

  return (
    <label className="block relative" ref={wrapRef}>
      {label && (
        <span className="text-[11px] uppercase tracking-wider text-[#6B5840]">{label}</span>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full mt-1 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-[15px]"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute left-0 right-0 mt-1 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md max-h-56 overflow-y-auto z-50 spine-shadow">
          {filtered.map(opt => (
            <li key={opt}>
              <button
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#F4EBD9]"
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
