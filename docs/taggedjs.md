# TaggedJS Notes

Glanceboard uses TaggedJS for browser components. Future edits should follow these patterns so dynamic panels update instead of freezing values from the first render.

## Subscribe To All State Used By A Component

If a component reads more than one reactive store, use `subscribe.all`.

```ts
export const Example = tag(() =>
  subscribe.all([hardware$, rotation$], ([[hardware], [rotation]]) => {
    return div(
      span(hardware?.status?.status ?? "idle"),
      span(rotation?.currentCardId ?? "none")
    );
  })
);
```

Nested `subscribe(...)` calls can work, but they are easy to get wrong when parent and child content both depend on changing state.

## Use Function Children For Changing Values

When a child value should be evaluated again after a reactive update, pass a function child.

```ts
h2("Display: ", () => card?.title ?? "Loading");

button.onClick(actions.toggleRotationPause)(
  (_: unknown) => state?.paused ? "Resume" : "Pause"
);

pre((_: unknown) => JSON.stringify(parsed, null, 2));
```

Avoid computing nested display data once and passing only static strings or static tag arrays when the source object will be replaced by later state updates.

## Wrap Reusable Dynamic Sections In `tag`

For child sections that accept changing inputs, make them TaggedJS components and update local derived values with `.inputs(...)`.

```ts
const DetailsPanel = tag((card: DisplayCard) => {
  let parsed = parsedDataForCard(card);

  DetailsPanel.inputs(([nextCard]) => {
    card = nextCard;
    parsed = parsedDataForCard(card);
  });

  return pre((_: unknown) => JSON.stringify(parsed, null, 2));
});
```

This is useful when the parent swaps to another card but the section's internal derived data must update without remounting everything manually.

## Key Mapped Children

When returning arrays of tags, key each item with a stable primitive or stable object reference.

```ts
summaryItems.map(([label, value]) =>
  div(strong(label), span(value)).key(label)
);
```

Do not use fresh inline objects or arrays as keys, because they change identity every render.
