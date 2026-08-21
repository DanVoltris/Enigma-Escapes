// Opts a manager page into the board treatment: the full window width, and
// cards that carry their heading on a strip.
//
// A marker rather than a wrapper on purpose. Every page would otherwise have to
// have its whole tree wrapped in a div, which is a lot of JSX surgery on twenty
// files for a styling decision — and the one time it was done by hand it closed
// a tag in the wrong component. The stylesheet keys off this being present
// anywhere on the page.
export default function BoardPage() {
  return <div className="mgr-board mgr-panels" hidden aria-hidden="true" />;
}
