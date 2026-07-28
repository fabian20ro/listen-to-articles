/**
 * Reusable text filter for any list of DOM items.
 *
 * Creates an <input type="search"> and attaches it to a container element.
 * As the user types, list items that don't match are hidden (display: none).
 */

export interface ListFilterOptions {
  /** The container element to insert the search input into (e.g., a header bar). */
  container: HTMLElement;

  /** The list element whose direct children will be filtered. */
  list: HTMLElement;

  /** Placeholder text shown in the input. Defaults to "Filter". */
  placeholder?: string;

  /** Accessible label for screen readers. Defaults to placeholder value. */
  ariaLabel?: string;

  /**
   * Extract searchable text from a list item.
   * Defaults to `(el) => el.textContent ?? ''`.
   */
  getText?: (item: HTMLElement) => string;

  /** If provided, insert the input before this element instead of appending. */
  insertBefore?: HTMLElement;

  /**
   * Debounce duration in milliseconds for filter re-application during typing.
   * Defaults to 150ms. Set to 0 or null to disable debouncing.
   */
  inputDebounceMs?: number | null;

  /**
   * Text shown below the search input when no items match. Defaults to "No results found".
   * Set to null or empty string to disable the message entirely.
   */
  noResultsMessage?: string | null;
}

export class ListFilter {
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly getText: (item: HTMLElement) => string;
  private readonly noResultsMsg: string | null;
  private readonly debounceMs: number | null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private messageEl: HTMLSpanElement | null = null;

  constructor(opts: ListFilterOptions) {
    this.list = opts.list;
    this.getText = opts.getText ?? ((el) => el.textContent ?? '');
    this.debounceMs = opts.inputDebounceMs ?? 150;
    this.noResultsMsg = (opts.noResultsMessage !== undefined && opts.noResultsMessage !== null && opts.noResultsMessage !== '') ? opts.noResultsMessage : null;

    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.className = 'list-filter-input';
    this.input.placeholder = opts.placeholder ?? 'Filter';
    this.input.setAttribute('aria-label', opts.ariaLabel ?? opts.placeholder ?? 'Filter');
    this.input.autocomplete = 'off';

    if (opts.insertBefore) {
      opts.container.insertBefore(this.input, opts.insertBefore);
    } else {
      opts.container.appendChild(this.input);
    }

    // Use a debounced handler for typing; the `search` event is still immediate
    // because WebKit fires it when the native clear button is clicked.
    const applyWithDebounce = () => this.debounceApply();
    this.input.addEventListener('input', applyWithDebounce);
    this.input.addEventListener('search', () => this.applyFilter());

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
      if (e.key === 'Escape' && this.input.value) {
        e.stopPropagation();
        this.clear();
      }
    });
  }

  /** Cancel any pending debounce timer. */
  private cancelPending(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /** Show the no-results message below the search input, replacing any prior message. */
  private showMessage(text: string): void {
    const el = document.createElement('span');
    el.textContent = text;
    el.className = 'list-filter-no-results';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');

    if (this.messageEl !== null) {
      this.input.parentElement?.replaceChild(el, this.messageEl);
      this.messageEl = el;
      return;
    }
    this.input.after(el);
    this.messageEl = el;
  }

  /** Hide and remove the no-results message if present. */
  private removeMessage(): void {
    if (this.messageEl !== null) {
      this.messageEl.remove();
      this.messageEl = null;
    }
  }

  /** Apply filter with optional debouncing. */
  private debounceApply(): void {
    if (this.debounceMs === null || this.debounceMs <= 0) {
      this.applyFilter();
      return;
    }
    this.cancelPending();
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.applyFilter();
    }, this.debounceMs);
  }

  /** Re-apply the current filter query against list items. Call after list re-render. */
  applyFilter(): void {
    const query = this.input.value.toLowerCase().trim();
    const items = this.list.children;
    let matchCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as HTMLElement;
      if (!query) {
        item.style.removeProperty('display');
        matchCount += 1;
      } else {
        const text = this.getText(item).toLowerCase();
        const matches = text.includes(query);
        item.style.display = matches ? '' : 'none';
        if (matches) matchCount += 1;
      }
    }

    if (this.noResultsMsg !== null && matchCount === 0) {
      this.showMessage(this.noResultsMsg);
    } else {
      this.removeMessage();
    }
  }

  /** Clear the filter and show all items. */
  clear(): void {
    this.cancelPending();
    this.input.value = '';
    this.applyFilter();
  }
}
