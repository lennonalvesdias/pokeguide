// Restrições de aprendizado de golpes no FireRed (ADR-009).

export interface ForgetRule {
  canForgetInLearnScreen: boolean;
  reason?: 'hm-requires-move-deleter';
}

/** Golpes de HM não podem ser esquecidos na tela de aprendizado; exigem o Move Deleter. */
export function forgetRule(moveKey: string, hmMoves: readonly string[]): ForgetRule {
  return hmMoves.includes(moveKey)
    ? { canForgetInLearnScreen: false, reason: 'hm-requires-move-deleter' }
    : { canForgetInLearnScreen: true };
}

/** Candidatos a esquecer na tela de aprendizado, já sem os HMs. */
export function forgettableMoves(current: readonly string[], hmMoves: readonly string[]): string[] {
  return current.filter((m) => forgetRule(m, hmMoves).canForgetInLearnScreen);
}
