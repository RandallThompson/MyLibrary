import { X } from "lucide-react";

export default function Modal({ onClose, title, children, size = "md" }) {
  const widths = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl"
  };
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#2A1F14]/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-[#F4EBD9] border border-[#2A1F14]/15 rounded-2xl w-full ${widths[size]} p-6 spine-shadow max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="display text-xl">{title}</h2>
          <button onClick={onClose} className="text-[#6B5840] hover:text-[#2A1F14]">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
