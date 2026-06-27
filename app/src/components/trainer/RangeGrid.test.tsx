import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RangeGrid } from './RangeGrid';

describe('RangeGrid', () => {
  it('renders 169 cells and highlights the hero hand', () => {
    const { container } = render(
      <RangeGrid category="rfi" hero="UTG" highlight="AA" />
    );
    const cells = container.querySelectorAll('[data-hand]');
    expect(cells.length).toBe(169);
    const hero = container.querySelector('[data-hand="AA"]');
    expect(hero?.getAttribute('data-hero')).toBe('true');
  });
});
