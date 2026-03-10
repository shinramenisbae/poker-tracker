# Poker Tracker - Design Document

## Overview
A clean, intuitive poker tracking miniapp designed for iPad-optimized home game use. The design emphasizes earth tones inspired by Claude's aesthetic, with clear visual hierarchy for tracking buy-ins, cash-outs, and settlements.

---

## 1. Color Palette

### Primary Background Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `bg-primary` | `#F5F1EB` | Main app background - warm off-white |
| `bg-secondary` | `#EDE8E0` | Secondary surfaces, empty states |
| `bg-tertiary` | `#E5DED4` | Tertiary backgrounds, dividers |

### Card/Surface Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `surface-primary` | `#FFFFFF` | Cards, modals, elevated surfaces |
| `surface-secondary` | `#FAF8F5` | Subtle cards, inactive states |
| `surface-pressed` | `#F0EDE8` | Pressed/tapped states |

### Text Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `text-primary` | `#2D2A26` | Headlines, primary content |
| `text-secondary` | `#5C5852` | Body text, descriptions |
| `text-tertiary` | `#8A8580` | Placeholders, hints, disabled |
| `text-inverse` | `#FFFFFF` | Text on dark/colored backgrounds |

### Accent Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `accent-positive` | `#4A7C59` | Profits, positive numbers, success |
| `accent-positive-light` | `#E8F5E9` | Positive backgrounds, highlights |
| `accent-negative` | `#B85450` | Losses, negative numbers, warnings |
| `accent-negative-light` | `#FFEBEE` | Negative backgrounds, alerts |
| `accent-primary` | `#8B7355` | Primary actions, active states |
| `accent-primary-light` | `#D4C5B5` | Hover states, borders |

### Button States
| State | Background | Text | Border |
|-------|------------|------|--------|
| Primary Default | `#8B7355` | `#FFFFFF` | none |
| Primary Hover | `#7A6548` | `#FFFFFF` | none |
| Primary Pressed | `#6B5A3F` | `#FFFFFF` | none |
| Primary Disabled | `#D4C5B5` | `#8A8580` | none |
| Secondary Default | `#FFFFFF` | `#2D2A26` | `#D4C5B5` |
| Secondary Hover | `#FAF8F5` | `#2D2A26` | `#8B7355` |
| Secondary Pressed | `#F0EDE8` | `#2D2A26` | `#8B7355` |
| Destructive Default | `#B85450` | `#FFFFFF` | none |
| Destructive Hover | `#A34743` | `#FFFFFF` | none |

---

## 2. Typography

### Font Recommendations
**Primary Font:** Inter or SF Pro Display
- Clean, highly legible at all sizes
- Excellent for numbers (tabular figures)
- Native feel on iPad

**Fallback Stack:** `-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif`

### Size Hierarchy

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| H1 | 32px | 700 | 40px | Screen titles |
| H2 | 24px | 600 | 32px | Section headers |
| H3 | 20px | 600 | 28px | Card titles |
| H4 | 18px | 600 | 24px | Subsection headers |
| Body Large | 17px | 400 | 24px | Primary body text |
| Body | 16px | 400 | 22px | Standard body text |
| Body Small | 14px | 400 | 20px | Secondary text, labels |
| Caption | 12px | 500 | 16px | Tags, timestamps |
| Number Large | 28px | 600 | 32px | Large monetary values |
| Number Medium | 22px | 600 | 28px | Standard monetary values |
| Number Small | 17px | 600 | 22px | Small amounts |

### Number Formatting
- Use tabular figures (`font-variant-numeric: tabular-nums`)
- Always show 2 decimal places for currency: `$150.00`
- Negative numbers: `-$50.00` (with accent-negative color)
- Positive numbers: `+$50.00` or `$50.00` (with accent-positive color)

---

## 3. Component Designs

### Session Card (List View)

```
┌─────────────────────────────────────────────┐
│  🎲 Friday Night Poker          [Active]    │  ← H3 + Status Badge
│  Jan 15, 2026 • 8:30 PM                     │  ← Caption
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 6        │  │ $1,200   │  │ 2h 30m   │  │  ← Stats Row
│  │ Players  │  │ In Play  │  │ Duration │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                             │
│  [Continue Session]         [View Details]  │  ← Actions
└─────────────────────────────────────────────┘
```

**Specs:**
- Background: `surface-primary`
- Border-radius: 16px
- Padding: 20px
- Shadow: `0 2px 8px rgba(45, 42, 38, 0.08)`
- Status badge: Pill shape, `accent-primary` background for active
- Stats: Equal width columns, centered
- Tap target: Entire card tappable to open session

### Player Row (with Buy-in Controls)

```
┌─────────────────────────────────────────────┐
│ ┌────┐                                      │
│ │ 👤 │  Alex                    +$150.00    │  ← Avatar + Name + P/L
│ └────┘  ────────────────────────────────    │
│         Total Buy-in: $300                  │
│                                             │
│  [+$50]  [+$100]  [Custom]    [Cash Out]   │  ← Quick Actions
└─────────────────────────────────────────────┘
```

**Specs:**
- Background: `surface-secondary`
- Border-radius: 12px
- Padding: 16px
- Avatar: 44px circle, `bg-tertiary` background
- Name: H4 weight
- P/L: Number Medium, colored (green positive, red negative)
- Buy-in buttons: 44px height, `secondary` style
- Cash Out: `primary` button style

### Buy-in Quick Buttons

```
┌─────────┐  ┌─────────┐  ┌─────────┐
│  +$50   │  │ +$100   │  │ Custom  │
└─────────┘  └─────────┘  └─────────┘
```

**Specs:**
- Height: 44px (minimum touch target)
- Padding: 0 20px
- Border-radius: 10px
- `$50`, `$100`: Secondary button style
- `Custom`: Secondary style with `...` icon or outline variant
- On tap: Brief scale animation (0.98), then update total

### Cash Out Input

```
┌─────────────────────────────────────────────┐
│                                             │
│        Cash Out Amount                      │
│                                             │
│        ┌─────────────────────────┐          │
│        │  $  │  450  │  .  │ 00  │          │  ← Currency Input
│        └─────────────────────────┘          │
│                                             │
│        [Cancel]          [Confirm]          │
│                                             │
└─────────────────────────────────────────────┘
```

**Specs:**
- Modal overlay with `bg-primary` backdrop (90% opacity)
- Input: Large number pad style
- Font: Number Large
- Prefix: `$` symbol, `text-tertiary`
- Confirm button: Primary style, full width on mobile
- Cancel: Text button or secondary

### Settlement Summary View

```
┌─────────────────────────────────────────────┐
│  Session Complete 🎉                        │
│  Total Pot: $1,200                          │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  WINNERS                            │    │
│  │  🥇 Alex        +$250.00    ↑       │    │
│  │  🥈 Sam         +$100.00    ↑       │    │
│  ├─────────────────────────────────────┤    │
│  │  BREAKING EVEN                      │    │
│  │  Jordan           $0.00     →       │    │
│  ├─────────────────────────────────────┤    │
│  │  OWES MONEY                         │    │
│  │  🔄 Mike        -$150.00    ↓       │    │
│  │  🔄 Chris       -$200.00    ↓       │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [Share Results]        [New Session]       │
└─────────────────────────────────────────────┘
```

**Specs:**
- Grouped by status: Winners / Even / Losers
- Each group has subtle background tint
- Icons indicate direction (up/down/even)
- Amounts: Number Medium, colored appropriately
- Share button: Secondary with share icon
- New Session: Primary button

---

## 4. Layout Specifications

### iPad-Optimized Dimensions

**Container:**
- Max width: 800px (centered)
- Padding: 24px horizontal on tablet
- Safe area insets respected

**Breakpoints:**
| Device | Width | Layout |
|--------|-------|--------|
| iPad Pro 12.9" | 1024px | Full sidebar + main |
| iPad Pro 11" | 834px | Collapsed sidebar |
| iPad Mini | 744px | Single column |
| iPhone | < 430px | Compact, stacked |

### Touch Target Sizes
- Minimum: 44px × 44px (Apple HIG standard)
- Buttons: 44px height minimum
- List items: 60px height minimum
- Spacing between touch targets: 8px minimum

### Spacing System

| Token | Value | Usage |
|-------|-------|-------|
| `space-xs` | 4px | Tight spacing, icon padding |
| `space-sm` | 8px | Between related elements |
| `space-md` | 16px | Standard component padding |
| `space-lg` | 24px | Section padding |
| `space-xl` | 32px | Major section dividers |
| `space-2xl` | 48px | Screen-level spacing |

### Grid
- 12-column grid on iPad
- 4-column grid on iPhone
- Gutter: 16px
- Margin: 24px (iPad), 16px (iPhone)

---

## 5. Interaction Patterns

### How to Add a Player

**Flow:**
1. Tap "+ Add Player" button (primary, bottom of player list)
2. Modal appears with:
   - Name input field (auto-focused)
   - Optional: Starting buy-in amount
   - "Add" and "Cancel" buttons
3. Enter name, tap "Add" or press Return
4. Player appears in list with default $0 buy-in

**Shortcuts:**
- Quick add: Type name + Enter (uses default $100 buy-in)
- Bulk add: Comma-separated names in input

**Visual Feedback:**
- New player slides in from top
- Brief highlight flash on the new row
- Haptic feedback on device

### How to Record Buy-ins

**Flow:**
1. Locate player in active session list
2. Tap one of the quick buttons:
   - `+$50` - Adds $50 to player's total
   - `+$100` - Adds $100 to player's total
   - `Custom` - Opens number pad for arbitrary amount
3. Amount updates immediately with animation
4. Session total updates in header

**Visual Feedback:**
- Button press: Scale to 0.95, then back
- Amount change: Number "pops" (scales up briefly)
- Running total: Smooth count-up animation
- Toast notification: "Alex: +$100 buy-in" (auto-dismiss 2s)

**Edge Cases:**
- Custom amount allows any positive number
- Can record multiple buy-ins per player
- Undo available via swipe or shake gesture

### How to Cash Out

**Flow:**
1. Tap "Cash Out" button on player row
2. Modal appears with:
   - Large number input (currency format)
   - Quick suggestions: Current buy-in amount, $0, Custom
   - "Cancel" and "Confirm" buttons
3. Enter final amount
4. Tap "Confirm"
5. Player marked as "cashed out" in list

**Visual Feedback:**
- Modal slides up from bottom
- Number pad with large touch targets
- Confirm button pulses when valid amount entered
- Player row grays out slightly when cashed out
- Checkmark appears next to player name

**Edge Cases:**
- Can edit cash-out amount before session ends
- Cash-out can be less than buy-in (loss)
- Cash-out can be more than buy-in (win)

### How to View Settlements

**Flow:**
1. When all players cashed out, "End Session" button becomes active
2. Tap "End Session"
3. Confirmation dialog: "End session and calculate settlements?"
4. On confirm, navigate to Settlement Summary view
5. View shows:
   - Who won and how much
   - Who lost and how much
   - Simplified who-pays-who breakdown

**Settlement Calculation Display:**
```
Simplified Transfers:
• Mike pays Alex $150
• Chris pays Alex $100
• Chris pays Sam $100
```

**Actions Available:**
- Share: Generates text summary for copying/sending
- New Session: Clears and starts fresh
- Edit: Return to session if mistake found

**Visual Feedback:**
- Smooth transition to summary view
- Numbers animate counting up to final values
- Winners highlighted with subtle green tint
- Share button shows platform share sheet

---

## 6. Additional UI Elements

### Empty States

**No Active Session:**
```
┌─────────────────────────────────────────────┐
│                                             │
│              🎲                             │
│                                             │
│         No Active Session                   │
│                                             │
│    Start a new session to track             │
│    buy-ins and calculate settlements        │
│                                             │
│         [+ New Session]                     │
│                                             │
└─────────────────────────────────────────────┘
```

### Loading States
- Skeleton screens for session list
- Pulsing placeholder for calculations
- Spinner on async operations

### Error States
- Inline validation on inputs
- Toast notifications for errors
- Retry buttons on network failures

---

## 7. Accessibility

- Minimum contrast ratio: 4.5:1 for text
- Touch targets: 44px minimum
- Dynamic type support for all text
- VoiceOver labels for all interactive elements
- Reduce motion support for animations
- High contrast mode support

---

## 8. Animation Guidelines

**Timing:**
- Micro-interactions: 150ms
- Transitions: 250ms
- Page transitions: 350ms
- Easing: `cubic-bezier(0.4, 0.0, 0.2, 1)`

**Principles:**
- Purposeful: Every animation guides attention
- Subtle: Enhance, don't distract
- Fast: Keep interactions snappy
- Consistent: Same patterns throughout
