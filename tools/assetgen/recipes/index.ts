import type { Recipe } from '../recipe';
import { qiShrine } from './qiShrine';
import { commandHall } from './commandHall';
import { barracks } from './barracks';
import { refinery } from './refinery';
import { arrowTower, wall } from './tower';
import { halberdier, archer, daoist } from './infantry';
import { woodenOx } from './woodenOx';
import { pine, bamboo, peachTree, rock, scholarRock, jadeSmall, jadeLarge } from './environment';

export const RECIPES: Recipe[] = [
  // structures
  commandHall, qiShrine, barracks, refinery, arrowTower, wall,
  // units
  halberdier, archer, daoist, woodenOx,
  // resources
  jadeSmall, jadeLarge,
  // environment
  pine, bamboo, peachTree, rock, scholarRock,
];
