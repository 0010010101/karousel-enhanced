class InfiniteScroller implements Desktop.Scroller {
    public scrollToColumn(desktop: Desktop, column: Column) {
        // Center the column in the visible area for infinite scrolling feel
        const columnCenter = column.getLeft() + column.getWidth() / 2;
        const visibleRange = desktop.getCurrentVisibleRange();
        const visibleCenter = visibleRange.getLeft() + visibleRange.getWidth() / 2;
        
        // Smooth scroll to center the focused column
        const targetScrollX = columnCenter - visibleRange.getWidth() / 2;
        desktop.setScroll(targetScrollX, false);
    }
}
