import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../entrypoints/background';
import { listAnnotations } from './annotation-storage';
import { sendAnnotationWrite } from './annotation-messages';

const pageUrl = 'https://example.com/message-test';

beforeEach(() => {
  fakeBrowser.reset();
  background.main();
});

describe('annotation write messages', () => {
  it('routes mutations through the background write owner', async () => {
    const created = await sendAnnotationWrite({
      type: 'annotation.add',
      pageUrl,
      input: {
        note: 'Created through the worker',
        selector: '#target',
        elementContext: { tagName: 'BUTTON' },
      },
    });

    expect(await listAnnotations(pageUrl)).toEqual([created]);

    const updated = await sendAnnotationWrite({
      type: 'annotation.update',
      pageUrl,
      id: created.id,
      changes: { note: 'Updated through the worker' },
    });
    expect(updated).toMatchObject({ id: created.id, note: 'Updated through the worker' });

    await expect(
      sendAnnotationWrite({ type: 'annotation.delete', pageUrl, id: created.id }),
    ).resolves.toBe(true);
    await expect(listAnnotations(pageUrl)).resolves.toEqual([]);
  });
});
