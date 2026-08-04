import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaSessionController } from '../lib/media-session';

// Mocking globals that jsdom doesn't provide
// @ts-expect-error - mocking global
globalThis.MediaMetadata = class {
  constructor(init: any) {
    Object.assign(this, init);
  }
};

describe('MediaSessionController', () => {
  let controller: MediaSessionController;
  let mockMetadata: any;
  let mockMediaSession: any;
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    
    // Mock navigator.mediaSession
    mockMetadata = {
      title: 'Title',
      artist: 'Artist',
      artwork: [],
    };
    
    mockMediaSession = {
      metadata: mockMetadata,
      playbackState: 'none' as MediaSessionPlaybackState,
      actionHandlers: new Map(),
      setActionHandler: vi.fn((name: string, handler: () => void) => {
        (mockMediaSession as any).actionHandlers.set(name, handler);
      }),
      setPositionState: vi.fn(),
    };

    // @ts-expect-error - mocking navigator
    Object.defineProperty(navigator, 'mediaSession', {
      value: mockMediaSession,
      configurable: true,
    });

    // Mock visibilityState
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
      writable: true,
    });

    playSpy = vi.spyOn(HTMLAudioElement.prototype, 'play').mockResolvedValue(undefined);
    pauseSpy = vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});

    controller = new MediaSessionController();
  });

  it('should activate and start audio', async () => {
    controller.activate('Test Title');
    
    expect(controller.active).toBe(true);
    expect(playSpy).toHaveBeenCalled();
  });

  it('should be idempotent — double activate does not re-play audio or restart keep-alive timer', async () => {
    controller.activate('Test Title');
    await Promise.resolve(); // let play() promise settle
    const firstCallCount = playSpy.mock.calls.length;
    const firstKeepAlive = (controller as any)['keepAliveTimer'];

    controller.activate(); // second activate — should be a no-op

    expect(controller.active).toBe(true);
    expect(playSpy.mock.calls.length).toBe(firstCallCount);
    expect((controller as any)['keepAliveTimer']).toBe(firstKeepAlive);
  });

  it('should deactivate and stop audio', () => {
    controller.activate();
    controller.deactivate();
    
    expect(controller.active).toBe(false);
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('should update metadata', () => {
    controller.updateMetadata('New Title', 'New Artist');
    expect(navigator.mediaSession.metadata?.title).toBe('New Title');
    expect(navigator.mediaSession.metadata?.artist).toBe('New Artist');
  });

  it('should update position state', () => {
    controller.updatePositionState(100, 50, 1);
    expect(navigator.mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 100,
      position: 50,
      playbackRate: 1,
    });
  });

  it('should dispose properly', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    controller.dispose();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('should append audio element to document.body on activate (Android Chrome requirement)', async () => {
    controller.activate('Test Title');
    await Promise.resolve(); // let play() promise settle

    const bodyChildren = Array.from(document.body.children);
    const audioEl = bodyChildren.find(el => el instanceof HTMLAudioElement);

    expect(audioEl).toBeDefined();
    expect(audioEl!.loop).toBe(true);
  });

  it('should clear keep-alive timer on deactivate', () => {
    controller.activate();
    // Timer should be set after activate (positive assertion)
    expect((controller as any)['keepAliveTimer']).not.toBeNull();

    controller.deactivate();

    // Direct state check — deterministic, no global object spy needed
    expect((controller as any)['keepAliveTimer']).toBeNull();
    expect(controller.active).toBe(false);
  });

  it('should use default metadata when no args provided', () => {
    controller.updateMetadata();
    expect(navigator.mediaSession.metadata?.title).toBe('Listen to Articles');
    expect(navigator.mediaSession.metadata?.artist).toBe('Listen to Articles');
  });

  it('should clamp position in updatePositionState', () => {
    controller.updatePositionState(100, 200, 1);
    expect(navigator.mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 100,
      position: 100,
      playbackRate: 1,
    });

    controller.updatePositionState(100, -5, 1);
    expect(navigator.mediaSession.setPositionState).toHaveBeenLastCalledWith({
      duration: 100,
      position: 0,
      playbackRate: 1,
    });

    controller.updatePositionState(100, 50, 0.01);
    expect(navigator.mediaSession.setPositionState).toHaveBeenLastCalledWith({
      duration: 100,
      position: 50,
      playbackRate: 0.1,
    });
  });

  it('should clamp negative position to 0 in updatePositionState', () => {
    controller.updatePositionState(100, -42, 1);
    expect(navigator.mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 100,
      position: 0,
      playbackRate: 1,
    });

    // Second call to verify prior state was not leaked
    controller.updatePositionState(50, 25, 1);
    expect(navigator.mediaSession.setPositionState).toHaveBeenLastCalledWith({
      duration: 50,
      position: 25,
      playbackRate: 1,
    });
  });

  it('should populate action handlers via setActions', () => {
    const actions = {
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      nexttrack: vi.fn(),
      previoustrack: vi.fn(),
    };
    controller.setActions(actions);

    expect(mockMediaSession.setActionHandler).toHaveBeenCalledTimes(8);
    const handler = mockMediaSession.actionHandlers.get('play');
    handler?.();
    expect(actions.play).toHaveBeenCalled();
  });

  it('should dispose remove audio from DOM and revoke object URL', () => {
    controller.activate();
    const urlBefore = controller['silentUrl'] as string | null;

    controller.dispose();

    expect(document.body.children.length).toBe(0);
    expect(urlBefore).not.toBeNull();
    expect(controller['silentUrl']).toBeNull();
  });

  it('should re-start silent audio on visibilitychange when returning from background', async () => {
    // Simulate Android Chrome pausing audio while page is hidden.
    controller.activate('Test Title');
    await Promise.resolve();
    playSpy.mockClear();
    (document as any).visibilityState = 'hidden';
    const event = new Event('visibilitychange');
    document.dispatchEvent(event);

    // While hidden: no replay should happen.
    expect(playSpy).not.toHaveBeenCalled();

    // Simulate returning to foreground — audio is paused, so it should restart.
    (document as any).visibilityState = 'visible';
    const resumeEvent = new Event('visibilitychange');
    document.dispatchEvent(resumeEvent);

    await Promise.resolve();
    expect(playSpy).toHaveBeenCalled();
  });
});
