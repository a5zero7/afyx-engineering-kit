#include "Shape.hpp"

Rectangle::Rectangle(double w, double h) : width(w), height(h) {}

double Rectangle::area() const {
    return width * height;
}

double compute_total() {
    Rectangle rect(5.0, 4.0);
    return rect.area();
}

