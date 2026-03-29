export const cleanNumericValue = (value: any): number | null => {
  const num = Number(value);
  if (Number.isNaN(num) || num <= 0) {
    return null;
  }
  return num;
};
