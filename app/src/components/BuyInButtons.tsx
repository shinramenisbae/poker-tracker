interface BuyInButtonsProps {
  onBuyIn: (amount: number) => void;
  onCustom: () => void;
  disabled?: boolean;
}

export function BuyInButtons({ onBuyIn, onCustom, disabled }: BuyInButtonsProps) {
  const amounts = [50, 100, 200];

  return (
    <div className="flex gap-2">
      {amounts.map((amount) => (
        <button
          key={amount}
          onClick={() => onBuyIn(amount)}
          disabled={disabled}
          className="flex-1 btn-secondary h-11 text-sm disabled:opacity-50"
        >
          +${amount}
        </button>
      ))}
      <button
        onClick={onCustom}
        disabled={disabled}
        className="flex-1 btn-secondary h-11 text-sm disabled:opacity-50"
      >
        Custom
      </button>
    </div>
  );
}