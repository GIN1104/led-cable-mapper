# LED Cable Mapper

Production-ready web tool for LED video wall cable mapping, routing visualization, and packing lists.

## Stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4

## Prerequisites

Node.js 18+ (LTS recommended) with npm in PATH.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Features

- Cabinet grid with snake-pattern data routing
- Auto-split data ports (550k px / 10 cabinets per 1G port)
- V-Backup redundancy chains
- Power line splitting (3500W max per line)
- SVG visualization with data/power/backup arrows
- Text routing schema for stage crew
- Cable schedule table with IDs and color coding
- Packing list with +10% spare
- Print-friendly layout (`Print Scheme` button)
