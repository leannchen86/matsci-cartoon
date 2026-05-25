---
name: matsci-cartoon
description: Build and revise interactive WebGL materials-science cartoons in the matsci-cartoon repo. Use when creating or improving explainers like the tapioca starch retrogradation visualization, choosing scientifically honest visual encodings, reducing UI clutter, testing responsive Three.js pages, publishing GitHub Pages, or preserving lessons from prior project iterations.
---

# Materials Science Cartoon Builder

Use this skill to make pretty, intuitive materials-science visualizations without turning mechanisms into misleading decoration.

## Working Loop

1. Start with the real material mechanism: name the relevant structures, state variables, and limits of the model.
2. Map each visual object to one physical idea before adding VFX.
3. Prefer direct visual transformation over explanatory labels: make the same object change state when possible.
4. Keep presets as narrative anchors and sliders as exploratory controls.
5. Remove any mark, particle, plate, ring, glow, or card that cannot explain what it represents.
6. Test desktop and phone viewports before publishing.

## Scientific Representation Rules

For tapioca pearls, represent the pearl as a continuous starch-water gel, not a box of separate particles. The green/gel lines are representative starch polymer chains: amylose and amylopectin chain paths. They are not individual atoms, beads, or every molecule in the pearl.

Show cold aging as chain segments becoming more aligned, packed, and lower-mobility, with stronger shell/core moisture-stiffness gradients. Retrogradation is reassociation and partial ordering of starch chains, helped by hydrogen bonding and water redistribution. Do not show retrogradation as freestanding objects that appear from nowhere.

Show reheating as increased mobility and partial disruption of ordered associations. It should not erase history perfectly; a microwaved, previously refrigerated pearl can recover chewiness but should still carry some aging/moisture penalty.

Show water as mobility tracers only. Blue particles are a scale abstraction for mobile water behavior in the gel, not literal water molecules at true count or true size.

State clearly in code comments or UI copy when a view is representative. Avoid calling it a molecular simulation unless it actually simulates molecular dynamics.

## Decisions To Keep

- Use Three.js/WebGL for live spatial intuition, motion, shaders, and state transitions.
- Use a tasteful, high-contrast palette where chains and water remain visible in cooked, fridge, and microwave states.
- Use three presets: `Cooked`, `Fridge`, and `Microwave`. They help people reason by condition before touching sliders.
- Use sliders for the core factors: temperature, pearl moisture, and fridge/storage time.
- Morph the same starch chains from disordered hydrated paths toward aligned/packed paths as retrogradation increases.
- Tie water particle size, opacity, and motion to computed water mobility.
- Represent shell/core effects with material gradients and surface behavior, not with an unexplained sliced cutaway.
- Use hover tooltips on the actual chains, water tracers, and gradient/surface objects instead of permanent explanatory labels.
- Keep visible text sparse. Let motion, alignment, density, opacity, and placement carry the explanation.
- On small screens, preserve the pearl as the first visual focus and collapse or move controls so they do not cover the scene.
- During repo migration, copy first, compare, commit in the new repo, publish, and leave the source repo intact unless explicitly asked to delete it.

## Aesthetic Direction

Aim for serious, luminous, readable scientific cartoons: soft cinematic lighting, restrained bloom, high contrast against the background, and motion that explains state change. The work should feel closer to a beautiful interactive micrograph than a dashboard, game UI, or decorative sci-fi scene.

Prefer elegant abstraction over literal clutter. Use color, glow, particles, shaders, and motion as encodings for material properties such as water mobility, chain alignment, heat, stress, and gradients. Do not add effects just because they look impressive.

Keep the visual field calm enough for one mechanism to be seen at a glance. If an aesthetic element competes with the core material transformation, remove it or make it subordinate.

## Decisions To Avoid

- Do not use yellow retrogradation rectangles/domains as static highlights unless they are visibly produced by chain alignment and clearly explained.
- Do not add green balls or beads for starch; they imply discrete particles that are not present at this visual scale.
- Do not add concentric rings, white rings, blue plates, sliced notches, or cut-flat openings unless each one corresponds to a real structure being taught.
- Do not decorate with VFX that are not bound to material variables. Glow is fine only when it reinforces mobility, stress, water, heat, or surface state.
- Do not rely on a large text panel or legend to explain the scene. If users must read a lot to understand the basic mechanism, simplify the visual mapping.
- Do not make controls or readouts cover the pearl on mobile.
- Do not imply refrigerated domains magically disappear on cooking or microwaving. Show reversible/partial changes in the same chain system.
- Do not overstate precision. This is a conceptual microstructure cartoon, not a quantitative molecular model.

## Error Log

- Static yellow retrogradation blocks looked like new matter appearing in the fridge and vanishing on reheating. Fix by transforming the same polymer chains and reserving highlights for derived alignment regions.
- Green beads suggested literal starch particles or molecules. Fix by using chain lines and describing them as representative amylose/amylopectin paths.
- Concentric rings, a white ring, a blue plate, and a flat cutaway notch were interpreted as unexplained structures. Fix by removing decorative or accidental geometry unless it maps to shell/core gradient or pearl boundary.
- Dense permanent labels consumed space and made the visualization feel like a diagram caption. Fix by using object-hover tooltips and minimal copy.
- Fridge-state small particles and cooked/fridge chains were too low contrast. Fix by checking each preset and tuning color/opacity against the actual background.
- Desktop controls initially blocked part of the pearl. Fix by moving controls to the right rail on wide layouts.
- Mobile controls blocked the real boba. Fix by testing a phone viewport and using collapsible/fixed controls that preserve the pearl as the first-screen focus.
- In-app browser testing may not expose viewport resizing. Use local/headless Chrome screenshots for phone-size checks when needed.
- Headless Chrome may render a blank WebGL screenshot unless software WebGL is enabled. Add `--enable-unsafe-swiftshader` for smoke-test screenshots.
- GitHub Pages can return `404` while building. Poll Pages status and public HTTP `200` before claiming the URL is live.
- Repo migration is risky if treated as a destructive move. Copy the working file, compare it byte-for-byte when possible, initialize the new repo, then publish.

## Validation Checklist

Before finishing a visualization change:

- Verify every visible object has a physical meaning.
- Verify the visual change between presets matches the stated science.
- Verify cooked, fridge, and microwave remain visually distinct.
- Verify water mobility changes are visible, not just numerical.
- Verify hover targets explain actual objects.
- Verify desktop and mobile screenshots.
- Verify public GitHub Pages routes after publishing.
