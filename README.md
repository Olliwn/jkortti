# Joulukortti Peli (Christmas Card Game)

An interactive 3D web game where you can throw snowballs at a Christmas card. The card is physically simulated and will react to hits, swinging on a string. Snowballs leave white splatter marks where they hit the card.

## Features

- 3D graphics using Three.js
- Realistic physics simulation using Cannon.js
- Interactive cannon control with mouse
- Adjustable snowball size and throwing power
- Snow splatter effects on both sides of the card
- Physics-based card movement with string simulation

## How to Play

1. Use your mouse to aim the cannon:
   - Move mouse up/down for elevation (0-90 degrees)
   - Move mouse left/right for direction (-90 to +90 degrees)

2. Adjust the controls:
   - Use the "Snowball Size" slider to change the size of snowballs
   - Use the "Cannon Power" slider to adjust throwing power

3. Click and release to shoot snowballs at the card

## Running Locally

1. Clone this repository
2. Start a local web server in the project directory
   ```bash
   python -m http.server 8000
   ```
3. Open `http://localhost:8000` in your web browser

## Dependencies

- Three.js for 3D graphics
- Cannon.js for physics simulation

## License

MIT License - feel free to use and modify as you like! 