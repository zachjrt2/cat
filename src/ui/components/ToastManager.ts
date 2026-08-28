import { sound } from '../../systems/SoundManager';

export class ToastManager {
  private activeToasts: { el: HTMLElement; timerId: number }[] = [];
  private pendingToastQueue: string[] = [];
  private flushToastTimerId: number | null = null;
  private modalObserver: MutationObserver | null = null;
  private toastStack: HTMLElement;

  constructor(private root: HTMLElement) {
    const stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    this.root.appendChild(stack);
    this.toastStack = stack;

    // Observe DOM changes to detect when modals are closed and release queued notifications
    this.modalObserver = new MutationObserver(() => {
      if (!this.isModalOpen() && this.pendingToastQueue.length > 0) {
        this.flushToastQueue();
      }
    });
    this.modalObserver.observe(document.body, { childList: true, subtree: true });
  }

  private isModalOpen(): boolean {
    return Boolean(document.querySelector('.modal-backdrop, .modal, .plinko-modal-backdrop, .glossary-modal-backdrop'));
  }

  showToast(message: string): void {
    if (this.isModalOpen()) {
      // Prevent consecutive duplicates in queue
      if (this.pendingToastQueue.length === 0 || this.pendingToastQueue[this.pendingToastQueue.length - 1] !== message) {
        this.pendingToastQueue.push(message);
      }
      return;
    }
    this.displayToast(message);
  }

  private flushToastQueue(): void {
    if (this.flushToastTimerId !== null) return;
    if (this.isModalOpen() || this.pendingToastQueue.length === 0) return;

    // Rapidly release queued toasts one by one
    this.flushToastTimerId = window.setInterval(() => {
      if (this.isModalOpen() || this.pendingToastQueue.length === 0) {
        if (this.flushToastTimerId !== null) {
          clearInterval(this.flushToastTimerId);
          this.flushToastTimerId = null;
        }
        return;
      }

      const nextMsg = this.pendingToastQueue.shift();
      if (nextMsg) {
        this.displayToast(nextMsg);
      }
    }, 150);
  }

  private displayToast(message: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = message;

    const item = {
      el,
      timerId: 0,
    };

    // Click to dismiss
    el.addEventListener('click', () => {
      sound.playTap();
      this.dismissToast(item);
    });

    // Auto-expire after 3.8s
    item.timerId = window.setTimeout(() => {
      this.dismissToast(item);
    }, 3800);

    // Newest one is added to the bottom of the deck
    this.activeToasts.push(item);
    this.toastStack.appendChild(el);

    this.updateToastDeck();
  }

  private dismissToast(item: { el: HTMLElement; timerId: number }): void {
    const idx = this.activeToasts.indexOf(item);
    if (idx === -1) return;

    window.clearTimeout(item.timerId);
    this.activeToasts.splice(idx, 1);

    // Animate the expired card up & out
    item.el.style.opacity = '0';
    item.el.style.transform = 'translate(0px, -22px) scale(0.92)';
    item.el.style.pointerEvents = 'none';

    setTimeout(() => {
      item.el.remove();
    }, 300);

    // Underlying cards immediately move up into position
    this.updateToastDeck();
  }

  private updateToastDeck(): void {
    const maxVisible = 4;

    this.activeToasts.forEach((item, index) => {
      // index 0 is the top card currently in front
      // subsequent cards are offset down (+Y) and a tiny bit to the right (+X)
      const offsetX = index * 4;
      const offsetY = index * 8;
      const scale = Math.max(0.88, 1 - index * 0.03);
      const opacity = index >= maxVisible ? 0 : Math.max(0.68, 1 - index * 0.12);
      const zIndex = 100 - index;

      item.el.style.zIndex = String(zIndex);
      item.el.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      item.el.style.opacity = String(opacity);
      item.el.style.filter = index === 0 ? 'none' : `brightness(${Math.max(0.82, 1 - index * 0.07)})`;
      item.el.style.pointerEvents = index === 0 ? 'auto' : 'none';
    });
  }

  destroy(): void {
    if (this.modalObserver) {
      this.modalObserver.disconnect();
      this.modalObserver = null;
    }
    if (this.flushToastTimerId !== null) {
      clearInterval(this.flushToastTimerId);
      this.flushToastTimerId = null;
    }
  }
}
