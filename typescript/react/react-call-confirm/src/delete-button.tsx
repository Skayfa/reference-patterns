import { Confirm } from "./confirm.js";

interface DeleteButtonProps {
  itemName: string;
  onDelete: () => void;
}

/**
 * Imperative usage from an event handler: the component holds no dialog
 * state — the question is a single awaited expression.
 */
export function DeleteButton({ itemName, onDelete }: DeleteButtonProps) {
  const handleClick = async () => {
    if (await Confirm.call({ message: `Delete "${itemName}"?` })) {
      onDelete();
    }
  };

  return (
    <button type="button" onClick={() => void handleClick()}>
      Delete
    </button>
  );
}
