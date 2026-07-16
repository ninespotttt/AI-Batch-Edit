import Panzoom from '@panzoom/panzoom';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

export function useImagePanzoom(imageUrl) {
  const imageElement = ref(null);
  let instance = null;
  let viewport = null;

  const onWheel = (event) => {
    event.preventDefault();
    instance?.zoomWithWheel(event);
  };

  function destroy() {
    viewport?.removeEventListener('wheel', onWheel);
    instance?.destroy();
    viewport = null;
    instance = null;
  }

  async function initialize() {
    await nextTick();
    destroy();
    if (!imageElement.value || !imageUrl()) return;
    viewport = imageElement.value.parentElement;
    instance = Panzoom(imageElement.value, {
      minScale: 1,
      maxScale: 4,
      contain: false,
      cursor: 'grab'
    });
    instance.reset({ animate: false, force: true });
    viewport.addEventListener('wheel', onWheel, { passive: false });
  }

  watch(imageUrl, initialize, { immediate: true });
  onBeforeUnmount(destroy);

  return { imageElement, initialize };
}
