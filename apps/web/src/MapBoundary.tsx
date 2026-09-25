import { Component, type ReactNode } from 'react';

export default class MapBoundary extends Component<
  { children: ReactNode; onList: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="list-explainer" role="status">
          <h2>โหลดส่วนแผนที่ไม่สำเร็จ</h2>
          <p>ประกาศยังอ่านได้จากรายการ</p>
          <button className="primary-button" onClick={this.props.onList}>
            ดูรายการประกาศ
          </button>
        </div>
      );
    return this.props.children;
  }
}
