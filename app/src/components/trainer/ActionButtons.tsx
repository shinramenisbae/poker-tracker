import type { ActionOption, Bucket } from '../../trainer/types';

interface Props {
  actions: ActionOption[];
  disabled: boolean;
  onChoose: (bucket: Bucket) => void;
  chosen?: Bucket;
}

export function ActionButtons({ actions, disabled, onChoose, chosen }: Props) {
  return (
    <div className="flex gap-2 mt-4">
      {actions.map((a) => {
        const isFold = a.kind === 'fold';
        const isChosen = chosen === a.bucket;
        return (
          <button
            key={a.bucket}
            disabled={disabled}
            onClick={() => onChoose(a.bucket)}
            className={[
              'flex-1 rounded-xl px-2 py-3 font-semibold text-sm border transition-colors disabled:opacity-60',
              isChosen ? 'ring-2 ring-text-primary' : '',
              isFold
                ? 'text-accent-negative border-accent-negative/40 bg-surface-secondary'
                : 'text-text-primary border-accent-primary-light bg-surface-secondary hover:border-accent-primary',
            ].join(' ')}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
