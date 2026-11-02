// The sizes a frame can be made at.
//
// Every one of these is a real surface something ships on, which is the whole point: a
// frame is not a rectangle to draw in, it is the size the thing will actually be. A story
// designed at 1080 x 1920 needs no reinterpretation later.

// Each group says whether a frame of that size may grow.
//
// A screen scrolls, so a phone or a desktop frame can get taller as what is in it gets
// taller. A post, a thumbnail or a poster is a fixed rectangle: whatever does not fit in
// it would not fit when it was published either, so it is cropped rather than grown.
export const FRAME_GROUPS = [
  ['Phone', true, [
    ['iPhone 16 Pro', 402, 874],
    ['iPhone SE', 375, 667],
    ['Android', 412, 915]
  ]],
  ['Tablet and desktop', true, [
    ['iPad', 834, 1194],
    ['iPad Pro', 1024, 1366],
    ['Laptop', 1280, 800],
    ['Desktop', 1440, 900],
    ['Full HD', 1920, 1080]
  ]],
  ['Social', false, [
    ['Instagram post', 1080, 1080],
    ['Instagram portrait', 1080, 1350],
    ['Story or reel', 1080, 1920],
    ['YouTube thumbnail', 1280, 720],
    ['Link preview', 1200, 630],
    ['X post', 1600, 900],
    ['LinkedIn post', 1200, 627],
    ['Pinterest pin', 1000, 1500]
  ]],
  ['Print', false, [
    ['A4 portrait', 1240, 1754],
    ['Square poster', 1500, 1500]
  ]]
];
