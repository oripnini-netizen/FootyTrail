import { X } from 'lucide-react';

export default function SelectedChips({
  title,
  items = [],
  onClear,
  getLabel = (item) => String(item),
  onRemoveItem,
  hoverClose = false,
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-gray-500">{title}</div>
        {onClear && (
          <button
            onClick={onClear}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <div
            key={item}
            className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-green-100 text-green-800 rounded-md"
          >
            {getLabel(item)}
            {onRemoveItem && (
              <button
                onClick={() => onRemoveItem(item)}
                className={`p-0.5 rounded-full hover:bg-green-200 ${
                  hoverClose ? 'opacity-0 group-hover:opacity-100' : ''
                }`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}