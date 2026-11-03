// Production teams report through the daily job sheet. Admins retain the full menu.
export function usesDailyReporting(user) {
  return (
    !!user &&
    user.role !== 'admin' &&
    /\b(developer|development|software|engineer|web head|website head|technical head|engineering|social|content|marketing|creative|design(?:er)?|editor|animator|animation|motion|videographer|copywriter|art director)\b/i.test(
      user.title || '',
    )
  );
}
