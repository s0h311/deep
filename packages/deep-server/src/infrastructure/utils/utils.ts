export function defined<T>(item: T | undefined): T {
  if (item === undefined) {
    throw new Error('item must be defined')
  }

  return item
}
