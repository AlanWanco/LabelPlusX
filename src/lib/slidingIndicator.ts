import { useLayoutEffect, type RefObject } from 'react'

/**
 * Keeps the `:scope > .sliding-indicator` child of a list pinned behind the active item.
 * The indicator is absolutely positioned inside the list, so it scrolls with the items;
 * CSS transitions on transform/width/height make it glide between items.
 */
export function useSlidingIndicator(
  listRef: RefObject<HTMLElement | null>,
  activeSelector: string,
  activeKey: string | number | null,
  itemCount: number,
) {
  useLayoutEffect(() => {
    const list = listRef.current
    const indicator = list?.querySelector<HTMLElement>(':scope > .sliding-indicator')
    if (!list || !indicator) {
      return
    }

    const measure = () => {
      const active = list.querySelector<HTMLElement>(activeSelector)
      if (!active) {
        indicator.dataset.visible = 'false'
        return
      }

      const isFirstPlacement = indicator.dataset.ready !== 'true'
      if (isFirstPlacement) {
        indicator.style.transition = 'none'
      }

      indicator.dataset.visible = 'true'
      // Empty translations use the warning tone so the indicator matches the item it covers.
      indicator.dataset.tone = active.classList.contains('label-item-empty') ? 'warning' : 'accent'
      indicator.style.width = `${active.offsetWidth}px`
      indicator.style.height = `${active.offsetHeight}px`
      indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`

      if (isFirstPlacement) {
        // Force a style flush while transitions are off so the first placement does not animate from the origin.
        indicator.getBoundingClientRect()
        indicator.style.transition = ''
        indicator.dataset.ready = 'true'
      }
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(list)
    const active = list.querySelector<HTMLElement>(activeSelector)
    if (active) {
      observer.observe(active)
    }

    return () => observer.disconnect()
  }, [listRef, activeSelector, activeKey, itemCount])
}
