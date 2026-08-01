import type { RoundConfig } from '@trivia/shared';
import type { ContentRepo } from '../../db/repos/contentRepo.js';
import { BoardRound } from './board.js';
import { QuickfireRound } from './quickfire.js';
import { WagerRound } from './wager.js';
import type { RoundHandler } from './RoundType.js';

/** Round type registry — add new round types here. */
export function createRoundHandler(config: RoundConfig, content: ContentRepo): RoundHandler {
  switch (config.type) {
    case 'board':
      return new BoardRound(config, content);
    case 'quickfire':
      return new QuickfireRound(config, content);
    case 'wager':
      return new WagerRound(config, content);
    default: {
      const t = (config as { type: string }).type;
      throw new Error(`Unknown round type: ${t}`);
    }
  }
}
