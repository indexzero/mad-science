# Task: Make an interactive 3D model of US Patent 1,269,608

## 1. Goal

Make an interactive 3D model of the "Three-Coin-Register Bank".
The inventor is Arthur E. Jacobs of Cleveland, Ohio.
The application date is March 25, 1912. The patent date is June 18, 1918.
The model must show the case and the internal mechanism.
The model must operate as the patent specification describes.

## 2. Input

- The patent PDF is at `./reference/US-1269608-A.pdf`.
- The PDF has 6 pages: 2 drawing sheets (Fig. 1 to Fig. 13) and 4 text pages.
- Read all pages before you write code.
- Convert each page to a PNG file in `./reference/pages/`. Use these images for visual comparison.

## 3. Checks and stop conditions

Do these checks before you write code:

1. Make sure that network access for npm is available.
2. Make sure that Playwright can start a headless Chromium browser.
3. Make sure that you can read the PDF and convert its pages to images.
4. Examine the skills that are available to you.

If a check fails, stop. Tell me what is not available. Do not continue.
If you need a skill that is not available, stop and tell me. Do not continue without it.
If a part of the patent is not clear, write your assumption in `ASSUMPTIONS.md`. Do not stop for small assumptions.

## 4. Reference approach

Use the same JavaScript approach that Addy Osmani uses in his public three.js posts.

Reference link: `<PASTE LINK HERE>`

- If the link is present, read it first. Use its stack, structure, and style.
- If the link is not present, search for his public three.js posts and repositories. One example is `github.com/addyosmani/chrome-dino-3d`.
- If you cannot find a clear match, stop and ask me for the link.
- Write the approach that you selected in `APPROACH.md`. Give the source for each decision.

## 5. Default stack

Use this stack unless the reference approach uses a different stack:

- three.js from npm, with ES modules.
- Vite for the development server and the build.
- `OrbitControls` for the camera.
- Plain HTML and CSS for the control panel. Do not use a UI framework unless the reference uses one.
- Web Audio API for the bell sound. Do not use audio files.
- `CanvasTexture` for the dial numbers and the case letters. Do not use image files.
- Vitest for unit tests. Playwright for visual tests.

Make all geometry in code. Do not download 3D models.

## 6. Scale

The patent does not give dimensions. Use real US coin diameters to set the scale:

- Dime: 17.91 mm
- Penny: 19.05 mm
- Nickel: 21.21 mm
- Quarter: 24.26 mm

Chute E3 must pass a quarter. Measure all other ratios from Fig. 1 and Fig. 2.

## 7. Parts to model

Use the patent reference letters in the object names. For example: `caseA`, `shaftB`, `dialC`.

| Ref. | Part | Data from the patent |
|---|---|---|
| A | Outer case | Shape as in Fig. 1 and Fig. 2. Vertical rear wall. Curved front. The base extends to the front. |
| A', A2, A3, A4 | Inner wall, curved bracket, end plates | A4 is the stationary plate. It holds stop K, lugs L and L', and ratchet openings O. |
| B | Central shaft | Horizontal, from the left side to the right side. The shaft end shows on the left side of the case (Fig. 1). |
| C | Cents dial (cup shape) | 20 spaces of 5 cents: 00, 05, 10, to 95. Ratchet openings C' in end wall C2. |
| D | Dollar dial (cup shape) | 20 spaces of $1.00: 0 to 19. Lugs P2 on the dial plate. |
| E | Flash | Turns on shaft B around the dials. End plates E' and E2. |
| E3 | Coin chute | On end plate E2. |
| E5 | Flash handle | Moves in slot E6 in the outer wall. |
| E7 | Coin slot | In the outer case. It aligns with chute E3 when the flash is up. |
| F, F' | Ratchet pawl, pawl plate | F' turns on shaft B. Pawl F engages C' through opening X in wall E2. Lugs F2 (quarter), F3 (dime), F4 (nickel). |
| G | Coin controller | On the flash. Arms G', G5, G6, G7. Curved end G2 goes into the chute through slot G3. Spring G4. |
| H, H' | Ratchet openings, spring pawls | Stop each dial at each space. |
| H2, H3 | Clapper, bell | The nickel dial pawl extends to H2. H2 hits bell H3. |
| K | Stop | Stops a penny. The flash cannot turn. |
| L, L' | Lugs on the stationary plate | L releases the coin. L' resets the controller. |
| O | Ratchet openings | Prevent backward movement of the flash. |
| P' | Cam plate | Pushes pawl R one time in each revolution of dial C. |
| Q | Lug on the flash | Engages lug F3 to return pawl plate F'. |
| R | Spring pawl | Turns dial D one space. |
| S | Spring | Returns the flash. |
| T | Strips on the flash | Lock pawls H' until the flash covers windows W. |
| V, V', V2, V3, V4 | Release pawls, openings, hood, pivot, door | Open the rear door at the release sum. |
| W | Windows | Show the dollar value and the cents value on the front. |

## 8. Case details (Fig. 1)

- Top sign text: "NICKELS-DIMES-QUARTERS".
- Eagle ornament above the windows. A simple low-relief shape is enough.
- Label above the windows: "AMOUNT-DEPOSITED".
- Labels below the windows: "DOLLARS" and "CENTS".
- Scroll ornament below the labels.
- Recessed rectangular panel on the front of the base.
- Handle E5 and coin slot E7 at the top right. Slot E6 goes down the right side.
- The patent does not specify a material. Select a material for a cast metal toy bank of the period. Write this in `ASSUMPTIONS.md`.

## 9. Mechanism behavior

Put the register logic in a separate module. This module must not import three.js.
The 3D scene reads its state from this module.

### 9.1 Deposit cycle

1. The user puts a coin in slot E7. The coin falls into chute E3.
2. The user pulls handle E5 down. The flash E turns (Fig. 4, arrow).
3. Arm G' touches the edge of the coin. The coin diameter sets the position of end G2.
4. End G2 engages one lug on pawl plate F':
   - Quarter: lug F2. Dial C moves 5 spaces.
   - Dime: lug F3. Dial C moves 2 spaces.
   - Nickel: lug F4. Dial C moves 1 space.
5. Arm G5 hits lug L. The controller releases the coin. The coin falls into the vault.
6. Clapper H2 hits bell H3 one time for each space that dial C moves.
7. Arm G7 engages ratchet openings O. The flash cannot turn back while a coin is in the chute.
8. The user releases the handle. Spring S returns the flash.
9. Arm G6 hits lug L'. The controller returns to its first position (Fig. 3).
10. Lug Q engages lug F3. Pawl plate F' returns.

### 9.2 Carry

When dial C completes one revolution (95 to 00), cam plate P' pushes pawl R. Pawl R turns dial D one space.

### 9.3 Penny

A penny puts end G2 in a position where it hits stop K. The flash cannot turn. The total does not change. Let the user remove the penny.

### 9.4 Tamper lock

Strips T keep pawls H' in ratchet openings H until the flash covers windows W. The user cannot turn the dials through the windows.

### 9.5 Release

At the release sum, pawls V fall into openings V' in both dials. Hood V2 falls on pivot V3. Door V4 opens. The user can then remove the coins.

- Make the release sum a setting.
- Default: $20.00. The dollar dial shows 0 to 19.
- Option: $10.00. The dollar dial shows 0 to 9 two times.

## 10. User interface

- Buttons: Nickel, Dime, Quarter, Penny, Reset.
- Let the user drag handle E5 with the pointer.
- Show the total in text next to the 3D view. It must agree with windows W.
- Toggle: Cutaway. Cut or hide the case to show the mechanism.
- Toggle: Labels. Show the patent reference letters on the parts.
- Toggle: Exploded view. Move the parts apart along shaft B.
- Camera presets: "Fig. 1" (front right perspective), "Fig. 2" (side section), "Fig. 8" (front, dials only).
- Toggle: Sound.
- Support mouse, touch, and keyboard. Support small screens.
- If the user sets `prefers-reduced-motion`, decrease the animation.

## 11. Verification loop

Do this loop after each large change:

1. Start the development server.
2. Open the page in headless Chromium with Playwright.
3. Make sure that the console shows no errors.
4. Take a screenshot from each camera preset. Save the screenshots in `./screenshots/`.
5. Examine each screenshot. Compare it with the related patent figure in `./reference/pages/`.
6. Record the differences in `VERIFY.md`.
7. Correct the model. Do the loop again.

Stop the loop when the proportions and part positions agree with the patent figures.
Do not tell me that the model is correct unless you examined the screenshots.

## 12. Tests

Write unit tests for the register logic:

- The start value is $0.00.
- One nickel gives $0.05. One dime gives $0.10. One quarter gives $0.25.
- $0.95 plus one nickel gives $1.00. Dial D moves one space.
- $0.90 plus one quarter gives $1.15. Dial D moves one space.
- The bell count is equal to the number of spaces that dial C moves.
- A penny does not change the total.
- At the release sum, door V4 opens.
- Set the state to $19.95. Make sure that the windows show "19" and "95", as in Fig. 1.

Write one Playwright test for each coin button.

## 13. Code comments

- In code comments, give the patent page and line numbers for each behavior. For example: "p. 2, lines 45 to 52".
- Do not use em dashes in text, comments, or documents.

## 14. Deliverables

- A Vite project with all source code.
- `npm run dev`, `npm run build`, and `npm test` must operate.
- A single-file HTML build at `dist-single/index.html`. It must open with no server.
- `README.md`: how to start the model, the controls, and a table of reference letters to code objects.
- `APPROACH.md`, `ASSUMPTIONS.md`, and `VERIFY.md`.
- The last screenshots in `./screenshots/`.

## 15. Report

When you complete the task, tell me:

- What you made.
- What you did not make, and why.
- Each assumption.
- The paths to the last screenshots.